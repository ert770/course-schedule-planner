import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';
import cors from 'cors';
import chatRoutes from './routes/chat.js';
import courseRoutes from './routes/courses.js';
import scheduleRoutes from './routes/schedule.js';
import profileRoutes from './routes/profile.js';
import reviewRoutes from './routes/reviews.js';
import authRoutes from './routes/auth.js';
import graduationRoutes from './routes/graduation.js';
import privacyRoutes from './routes/privacy.js';
import interactionRoutes from './routes/interactions.js';
import explorationRoutes from './routes/exploration.js';
import interestExplorationRoutes from './routes/interestExploration.js';
import historyFeedbackRoutes from './routes/historyFeedback.js';
import controlledBrowserRoutes, { controlledBrowserBodyError } from './routes/controlledBrowser.js';
import courseHistoryImportRoutes from './routes/courseHistoryImport.js';
import courseHistoryRoutes from './routes/courseHistory.js';
import { isMysqlConfigured } from './db/mysql.js';
import { isIsolatedHistoryMysqlE2E, isLocalSelfAttestedHistory, isSessionHistoryImport } from './services/isolatedHistoryE2E.js';
import { assertSessionSecretConfigured } from './services/sessionService.js';
import { assertPrivacyConfigured } from './services/privacyService.js';
import { assertInterestConfig, resolveCfInterestMode } from './skills/interestAlphas.js';
import { startCourseNeighborSchedule } from './services/courseNeighborService.js';
import { getHighsRuntime } from './skills/optimization/highsRuntime.js';
import { setSchedulingHighsRuntime } from './skills/scheduler.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
if (process.env.NODE_ENV !== 'test' && !process.env.NODE_TEST_CONTEXT && process.env.ISOLATED_HISTORY_MYSQL_E2E !== 'true' && process.env.LOCAL_MYFCU_PREVIEW !== 'true') {
  dotenv.config({ quiet: true });
  dotenv.config({ path: path.resolve(__dirname, '..', '..', '.env'), quiet: true });
}

export const app = express();
const PORT = process.env.PORT || 3001;


// Middleware
app.use(cors({
  origin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  credentials: true,
}));
// Larger import payloads are bounded; parser errors never echo submitted records.
app.use('/api/course-history-import', express.json({limit:'2mb'}), (err, _req, res, _next) => res.status(err.status === 413 ? 413 : 400).json({error:err.status === 413 ? '檔案過大' : '請求格式錯誤'}));
app.use(express.json());
app.use('/api/controlled-browser', controlledBrowserBodyError);

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/privacy', privacyRoutes);
app.use('/api/graduation', graduationRoutes);
app.use('/api/chat', chatRoutes);
app.use('/api/courses', courseRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/reviews', reviewRoutes);
app.use('/api/interactions', interactionRoutes);
app.use('/api/exploration', explorationRoutes);
app.use('/api/interest-exploration', interestExplorationRoutes);
app.use('/api/history-feedback', historyFeedbackRoutes);
app.use('/api/controlled-browser', controlledBrowserRoutes);
app.use('/api/course-history-import', courseHistoryImportRoutes);
app.use('/api/course-history', courseHistoryRoutes);

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

export function resolveControlledBrowserListenHost(env) {
  return env.NODE_ENV !== 'production' && (env.CONTROLLED_BROWSER_MOCK === 'true' || env.CONTROLLED_BROWSER_REAL_TEST === 'true' || env.LOCAL_MYFCU_PREVIEW === 'true') ? '127.0.0.1' : undefined;
}

export async function startServer(port = PORT) {
  if (process.env.LOCAL_MYFCU_SELF_ATTESTED_IMPORT === 'true' && !isLocalSelfAttestedHistory()) throw new Error('本機自行聲明匯入的隔離條件不符');
  if (process.env.LOCAL_MYFCU_SYNTHETIC_E2E === 'true' && !(process.env.LOCAL_MYFCU_PREVIEW === 'true' && isIsolatedHistoryMysqlE2E())) throw new Error('本機虛構測試模式僅能在隔離 E2E 使用');
  if (process.env.MYFCU_SESSION_IMPORT === 'true' && !isSessionHistoryImport()) throw new Error('MyFCU Session 匯入環境不符');
  if (process.env.LOCAL_MYFCU_PREVIEW === 'true' && isMysqlConfigured() && !isSessionHistoryImport() && (process.env.LOCAL_MYFCU_ALLOW_LOCAL_DB !== 'true' || process.env.DB_HOST !== '127.0.0.1' || process.env.DB_SSL_CA_PATH)) throw new Error('本機預覽拒絕非明確允許的本機資料庫');
  if (process.env.LOCAL_MYFCU_PREVIEW === 'true' && (process.platform !== 'win32' || process.env.NODE_ENV === 'production' || (process.env.CONTROLLED_BROWSER_MOCK === 'true' && !(isIsolatedHistoryMysqlE2E() && process.env.LOCAL_MYFCU_SYNTHETIC_E2E === 'true')) || process.env.CONTROLLED_BROWSER_REAL_TEST === 'true' || process.env.CONTROLLED_BROWSER_PERSONAL_TEST === 'true' || (process.env.ISOLATED_HISTORY_MYSQL_E2E === 'true' && !(isIsolatedHistoryMysqlE2E() && process.env.LOCAL_MYFCU_SYNTHETIC_E2E === 'true')))) throw new Error('本機 MyFCU 預覽環境不符');
  if (process.env.ISOLATED_HISTORY_MYSQL_E2E === 'true' && !isIsolatedHistoryMysqlE2E()) throw new Error('隔離 E2E 條件不符');
  if (process.env.CONTROLLED_BROWSER_PERSONAL_TEST === 'true') {
    throw new Error('本人登入測試尚未通過安全審查，無法啟用。');
  }
  if (process.env.CONTROLLED_BROWSER_MOCK === 'true' && process.env.CONTROLLED_BROWSER_REAL_TEST === 'true') {
    throw new Error('受控瀏覽器真實測試與 Mock 不可同時啟用。');
  }
  if ((process.env.CONTROLLED_BROWSER_MOCK === 'true' || process.env.CONTROLLED_BROWSER_REAL_TEST === 'true') && isMysqlConfigured() && !isIsolatedHistoryMysqlE2E()) {
    throw new Error('本機模擬模式不可連接 MySQL，請先清除 DB 設定。');
  }
  // 生產環境沒有固定、所有 replica 共用的 SESSION_SECRET 時直接拒絕啟動，
  // 而不是安靜地退回每個 process 各自產生的暫時密鑰——後者會讓重啟後所有
  // 登入 session 失效，多台 replica 之間也互相拒絕彼此簽的 cookie，而且
  // 症狀是隨機、難以重現的認證失敗，不是一個清楚可診斷的啟動錯誤。
  assertSessionSecretConfigured();
  assertPrivacyConfigured();
  // 興趣模型 α 總和超過 0.9、或 VECTOR_INTEREST_MODE 設成尚未開放的值時拒絕啟動（構想 5.1）。
  assertInterestConfig();

  // 階段 7：課程共現表每 24 小時重建一次；CF 關閉時不重建。資料表尚未建立時自動略過。
  if (resolveCfInterestMode(process.env.CF_INTEREST_MODE) !== 'off') startCourseNeighborSchedule();

  try {
    setSchedulingHighsRuntime(await getHighsRuntime());
  } catch (error) {
    console.warn(`HiGHS 載入失敗，多方案將退回綜合方案：${error.message}`);
  }

  // The simulated remote browser must never be reachable from another machine.
  const host = resolveControlledBrowserListenHost(process.env);
  return app.listen(port, host, () => {
    console.log(`\n🚀 課表規劃推薦系統後端已啟動`);
    console.log(`   http://localhost:${port}`);
    console.log(`   API: http://localhost:${port}/api\n`);
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  await startServer();
}

export default app;
