import { useState, useRef, useEffect } from 'react';
import { Send } from 'lucide-react';
import { chatAPI } from '../../services/api';
import { useAuth } from '../../contexts/useAuth';
import { useSchedule } from '../../contexts/useSchedule';
import { getUserIdentity } from '../../utils/userIdentity';

export default function ChatPanel({ onScheduleGenerated }) {
  // 聊天記憶與偏好更新都會寫進這位使用者，身分必須從 AuthContext 取得。
  // 先前這裡沒有帶 userId，後端以 `default` 假使用者接收，
  // 所有從 `/schedule` 發出的對話都寫到同一份共用資料上。
  const { user } = useAuth();
  const userIdentity = getUserIdentity(user);
  // 這是第二個 Chat 送出點（另一個在 DashboardPage）。兩處都要帶規劃狀態，
  // 否則同一句話在不同頁面會得到不同的行為。
  const { buildPlanningContext, applyResolvedAvoidances, clearSessionAvoidances } = useSchedule();
  const [messages, setMessages] = useState([
    {
      role: 'assistant',
      content: '👋 你好！我是你的課表規劃助手。\n\n我可以幫你：\n• 🔍 搜尋課程\n• 📊 查看評價與涼度\n• 📅 自動排課表\n• 🏖️ 推薦涼課\n\n試著告訴我你想做什麼吧！'
    }
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const messagesEndRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const sendMessage = async () => {
    const msg = input.trim();
    if (!msg || loading) return;

    if (userIdentity === null) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: '尚未登入，無法使用課表助手。請重新登入後再試。',
      }]);
      return;
    }

    setInput('');
    setMessages(prev => [...prev, { role: 'user', content: msg }]);
    setLoading(true);

    try {
      const res = await chatAPI.send(msg, buildPlanningContext());
      setMessages(prev => [...prev, { role: 'assistant', content: res.reply }]);

      // 只有「格式不合法」才清掉避開清單；後端暫時異常時要保留，
      // 否則使用者仍然有效的避開條件會無聲消失（見 planningContextService.js）。
      if (res.planningContextStatus === 'rejected-invalid') clearSessionAvoidances();

      // intent 為後端 agentService 的 tool 名稱，須與 run_csp_scheduler 完全一致
      if (res.intent === 'run_csp_scheduler' && res.data?.success) {
        // 伺服器算出來的最終避開範圍寫回 sessionStorage——Agent 追問原因之後，
        // 之後按一般「重新排課」才會沿用同一個範圍。
        applyResolvedAvoidances(res.data.appliedSessionAvoidances);
        // 一併帶回完整結果，呼叫端才拿得到 requestId／planId 記錄曝光（roadmap #2）。
        onScheduleGenerated?.(res.data.schedule, res.data);
      }
    } catch (err) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: `❌ 發生錯誤：${err.message}`
      }]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const quickActions = [
    '幫我排課表',
    '不要早八',
    '有什麼涼課',
    '搜尋資工系選修',
    '機器學習評價',
  ];

  const handleQuickAction = (text) => {
    setInput(text);
    inputRef.current?.focus();
  };

  const renderContent = (content) => {
    // Simple markdown-like rendering
    const parts = content.split(/(\*\*.*?\*\*)/g);
    return parts.map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return <strong key={i}>{part.slice(2, -2)}</strong>;
      }
      return part;
    });
  };

  return (
    <div className="chat-panel" id="chat-panel">
      <div className="chat-header">
        <div className="chat-header-icon">🤖</div>
        <div className="chat-header-info">
          <h3>課表規劃助手</h3>
          <p>用自然語言告訴我你的需求</p>
        </div>
      </div>

      <div className="chat-messages" id="chat-messages">
        {messages.map((msg, i) => (
          <div
            key={i}
            className={`message-bubble ${msg.role}`}
            style={{ animationDelay: `${i * 0.05}s` }}
          >
            <pre>{renderContent(msg.content)}</pre>
          </div>
        ))}

        {loading && (
          <div className="typing-indicator">
            <div className="typing-dot" />
            <div className="typing-dot" />
            <div className="typing-dot" />
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="quick-actions">
        {quickActions.map((text, i) => (
          <button
            key={i}
            className="quick-chip"
            onClick={() => handleQuickAction(text)}
          >
            {text}
          </button>
        ))}
      </div>

      <div className="chat-input-area">
        <input
          ref={inputRef}
          className="chat-input"
          placeholder="輸入你的需求... 例如「幫我排課表，不要早八」"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading}
          id="chat-input"
        />
        <button
          className="chat-send-btn"
          onClick={sendMessage}
          disabled={!input.trim() || loading}
          id="chat-send-btn"
        >
          <Send size={18} />
        </button>
      </div>
    </div>
  );
}
