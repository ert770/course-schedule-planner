import { useContext } from 'react';
import { ScheduleContext } from './ScheduleContextValue';

export function useSchedule() {
  const context = useContext(ScheduleContext);
  if (!context) throw new Error('useSchedule 必須在 ScheduleProvider 內使用');
  return context;
}
