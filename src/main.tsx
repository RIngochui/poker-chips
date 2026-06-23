import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import './index.css'
import App from './App.tsx'
import Landing from './pages/Landing.tsx'
import Join from './pages/Join.tsx'
import TablePage from './pages/TablePage.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route element={<App />}>
          <Route path="/" element={<Landing />} />
          <Route path="/join" element={<Join />} />
          <Route path="/table/:id" element={<TablePage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  </StrictMode>,
)
