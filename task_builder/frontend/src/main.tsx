import React from 'react'
import { createRoot } from 'react-dom/client'
import TaskBuilder from './TaskBuilder'

createRoot(document.getElementById('root')!).render(<React.StrictMode><TaskBuilder /></React.StrictMode>)
