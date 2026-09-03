import { useState, useRef, useEffect } from 'react';
import { Download, Calendar, Image, FileText, ChevronDown } from 'lucide-react';
import { exportToText, exportToIcs, exportToImage } from '../../utils/exportSchedule';

export default function ExportDropdown({ schedule, gridElementId = 'schedule-grid-container' }) {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef(null);

  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={dropdownRef} style={{ position: 'relative', display: 'inline-block' }}>
      <button 
        type="button"
        className="action-btn secondary" 
        onClick={() => setOpen(!open)}
        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
      >
        <Download size={16} />
        匯出課表
        <ChevronDown size={14} />
      </button>

      {open && (
        <div style={{
          position: 'absolute',
          top: '100%',
          right: 0,
          marginTop: '6px',
          backgroundColor: 'var(--color-bg-card, #fff)',
          color: 'var(--color-text-primary, #333)',
          borderRadius: '8px',
          boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
          padding: '6px',
          zIndex: 50,
          minWidth: '180px',
          display: 'flex',
          flexDirection: 'column',
          gap: '4px',
          border: '1px solid var(--color-border, #e5e7eb)'
        }}>
          <button
            type="button"
            onClick={() => { exportToIcs(schedule); setOpen(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', color: 'inherit' }}
          >
            <Calendar size={16} /> 匯出行事曆 (.ics)
          </button>
          <button
            type="button"
            onClick={() => { exportToImage(gridElementId); setOpen(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', color: 'inherit' }}
          >
            <Image size={16} /> 儲存為圖片 (.png)
          </button>
          <button
            type="button"
            onClick={() => { exportToText(schedule); setOpen(false); }}
            style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 12px', background: 'none', border: 'none', cursor: 'pointer', borderRadius: '4px', textAlign: 'left', color: 'inherit' }}
          >
            <FileText size={16} /> 純文字檔 (.txt)
          </button>
        </div>
      )}
    </div>
  );
}