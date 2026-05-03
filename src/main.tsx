import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App'

const rootElement = document.getElementById('root')
if (!rootElement) {
  throw new Error('index.html に <div id="root"> が見つかりません。')
}
createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
