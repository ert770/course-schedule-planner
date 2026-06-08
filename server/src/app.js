import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat.js';
import courseRoutes from './routes/courses.js';
import scheduleRoutes from './routes/schedule.js';
import profileRoutes from './routes/profile.js';
import reviewRoutes from './routes/reviews.js';
import authRoutes from './routes/auth.js';
import graduationRoutes from './routes/graduation.js';

const app = express();
const PORT = process.env.PORT || 3001;

// Middleware
app.use(cors());
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/graduation', graduationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/reviews', reviewRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 課表規劃推薦系統後端已啟動`);
  console.log(`   http://localhost:${PORT}`);
  console.log(`   API: http://localhost:${PORT}/api\n`);
});

export default app;
