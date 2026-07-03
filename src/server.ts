import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import jwt from 'jsonwebtoken';
import { PrismaClient } from '@prisma/client';
import { PublicKey } from '@solana/web3.js';
import mqtt from 'mqtt';
import nacl from 'tweetnacl';

dotenv.config();

const app = express();
const prisma = new PrismaClient();
const port = Number(process.env.PORT ?? 4000);

app.use(cors());
app.use(express.json());

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret';
const MQTT_BROKER_URL = process.env.MQTT_BROKER_URL ?? 'mqtt://localhost:1883';
const MQTT_USERNAME = process.env.MQTT_USERNAME;
const MQTT_PASSWORD = process.env.MQTT_PASSWORD;
const MQTT_CLIENT_ID = process.env.MQTT_CLIENT_ID ?? 'raid-backend';

let mqttClient: mqtt.MqttClient | null = null;

function connectMqtt() {
  if (mqttClient) return mqttClient;

  mqttClient = mqtt.connect(MQTT_BROKER_URL, {
    username: MQTT_USERNAME,
    password: MQTT_PASSWORD,
    clientId: MQTT_CLIENT_ID,
    reconnectPeriod: 5000,
    connectTimeout: 10000,
  });

  mqttClient.on('connect', () => {
    console.log('MQTT connected');
  });

  mqttClient.on('error', (error) => {
    console.error('MQTT error', error);
  });

  return mqttClient;
}

function verifyWalletSignature(payload: { walletAddress: string; message: string; signature: string }) {
  try {
    const publicKey = new PublicKey(payload.walletAddress);
    const messageBytes = Buffer.from(payload.message, 'utf8');
    const signatureBytes = Buffer.from(payload.signature, 'base64');
    return nacl.sign.detached.verify(
      messageBytes,
      signatureBytes,
      publicKey.toBytes(),
    );
  } catch {
    return false;
  }
}

function createSessionToken(walletAddress: string) {
  return jwt.sign({ walletAddress }, JWT_SECRET, { expiresIn: '1h' });
}

function authMiddleware(req: express.Request, res: express.Response, next: express.NextFunction) {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    res.status(401).json({ error: 'Missing authorization header' });
    return;
  }

  try {
    const token = authHeader.replace('Bearer ', '');
    const decoded = jwt.verify(token, JWT_SECRET) as { walletAddress: string };
    (req as express.Request & { user?: { walletAddress: string } }).user = { walletAddress: decoded.walletAddress };
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid session token' });
  }
}

app.post('/api/auth/login', async (req, res) => {
  try {
    const { walletAddress, message, signature } = req.body as {
      walletAddress: string;
      message: string;
      signature: string;
    };

    if (!walletAddress || !message || !signature) {
      res.status(400).json({ error: 'walletAddress, message, and signature are required' });
      return;
    }

    const verified = verifyWalletSignature({ walletAddress, message, signature });
    if (!verified) {
      res.status(401).json({ error: 'Invalid wallet signature' });
      return;
    }

    let user = await prisma.user.findUnique({ where: { walletAddress } });
    if (!user) {
      user = await prisma.user.create({
        data: { walletAddress, role: 'OPERATOR' },
      });
    }

    res.json({ token: createSessionToken(walletAddress), user });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Authentication failed' });
  }
});

app.post('/api/forklift/command', authMiddleware, async (req, res) => {
  try {
    const { forkliftId, command } = req.body as { forkliftId: string; command: string };
    if (!forkliftId || !command) {
      res.status(400).json({ error: 'forkliftId and command are required' });
      return;
    }

    const user = await prisma.user.findUnique({ where: { walletAddress: (req as express.Request & { user?: { walletAddress: string } }).user?.walletAddress } });
    if (!user || user.role !== 'OPERATOR') {
      res.status(403).json({ error: 'Operator authorization required' });
      return;
    }

    const forklift = await prisma.forklift.findUnique({ where: { id: forkliftId } });
    if (!forklift) {
      res.status(404).json({ error: 'Forklift not found' });
      return;
    }

    const client = connectMqtt();
    const topic = `forklift/${forkliftId}/control`;
    const payload = JSON.stringify({ command, timestamp: new Date().toISOString() });

    const telemetry = await prisma.telemetryLog.create({
      data: {
        forkliftId,
        operatorId: user.id,
        commandSent: command as any,
        success: false,
      },
    });

    const dispatchPromise = new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(new Error('Hardware dispatch timed out'));
      }, 4000);

      client.publish(topic, payload, (error) => {
        clearTimeout(timeout);
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });

    await dispatchPromise;

    await prisma.telemetryLog.update({
      where: { id: telemetry.id },
      data: { success: true },
    });

    res.json({ ok: true, topic, payload });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Command dispatch failed' });
  }
});

app.get('/api/forklift/:id/telemetry', async (_req, res) => {
  try {
    const telemetry = await prisma.telemetryLog.findMany({
      where: { forkliftId: _req.params.id },
      orderBy: { timestamp: 'desc' },
      take: 20,
    });
    res.json(telemetry);
  } catch (error) {
    res.status(500).json({ error: 'Telemetry fetch failed' });
  }
});

app.listen(port, () => {
  console.log(`Backend listening on http://localhost:${port}`);
});
