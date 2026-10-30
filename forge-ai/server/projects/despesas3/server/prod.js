// Production: one Express server for the built UI (dist/) and the API.
import express from 'express'
import path from 'node:path'
import { createApp } from './app.js'

const app = createApp()
const dist = path.resolve('dist')
app.use(express.static(dist))
app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')))
const port = Number(process.env.PORT || 3000)
app.listen(port, () => console.log(`App on http://localhost:${port}`))
