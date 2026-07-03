import { StrictMode, Component } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false }
  }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  componentDidCatch(error) {
    console.error('App runtime error:', error)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: '24px', background: '#0f172a', color: 'white' }}>
          <div style={{ maxWidth: '480px', textAlign: 'center' }}>
            <h1>Something went wrong</h1>
            <p>The dashboard hit a runtime error. Refresh the page to recover.</p>
            <button onClick={() => window.location.reload()} style={{ marginTop: '12px', padding: '10px 16px', borderRadius: '999px', cursor: 'pointer' }}>
              Reload page
            </button>
          </div>
        </div>
      )
    }

    return this.props.children
  }
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
