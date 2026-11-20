import { ArrowLeft, Check } from 'lucide-react';
import './PreferenceJourneySteps.css';

const steps = ['資料使用', '排課偏好', '課程探索'];

export default function PreferenceJourneySteps({ current }) {
  return (
    <nav className="preference-journey" aria-label="首次設定進度">
      <ol>
        {steps.map((label, index) => {
          const number = index + 1;
          return (
            <li key={label} aria-current={number === current ? 'step' : undefined} data-complete={number < current}>
              <span className="preference-journey-number" aria-hidden="true">
                {number < current ? <Check size={14} /> : number}
              </span>
              <span>{label}</span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function PreferenceBackButton({ onClick, children }) {
  return (
    <button type="button" className="preference-back" onClick={onClick}>
      <ArrowLeft size={18} aria-hidden="true" /> {children}
    </button>
  );
}
