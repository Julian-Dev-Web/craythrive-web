import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { APP_INFO } from '../constants/theme';
import { developerService } from '../services/developerService';

export default function DeveloperEntry() {
  const navigate = useNavigate();
  const clicks = useRef(0);
  const checking = useRef(false);
  const [error, setError] = useState('');

  async function activate() {
    if (checking.current) return;
    clicks.current += 1;
    if (clicks.current < 10) return;
    clicks.current = 0;
    checking.current = true;
    setError('');
    try {
      await developerService.checkAccess();
      navigate('/developer'); // The destination performs another server check.
    } catch {
      setError('Developer access is unavailable for this session.');
    } finally {
      checking.current = false;
    }
  }

  return <>
    <button type="button" className="modern-sidebar-logo developer-logo-button"
      style={{ backgroundImage: `url(${APP_INFO.logoPath})`, border: 0, padding: 0, flexShrink: 0 }}
      aria-label={`${APP_INFO.name} logo`} onClick={activate} />
    {error && <span className="developer-entry-notice" role="alert">{error}</span>}
  </>;
}
