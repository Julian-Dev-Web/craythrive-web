import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, ArrowRight, Compass } from 'lucide-react';
import { DASHBOARD_TOUR_STEPS, tankTourPath, tourCardPosition } from '../../utils/dashboardTour';

export default function DashboardTourOverlay({ onClose, focusBeforeTour }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [index, setIndex] = useState(0);
  const [tankPath, setTankPath] = useState(null);
  const [layout, setLayout] = useState(null);
  const dialog = useRef(null);
  const advanceButton = useRef(null);
  const step = DASHBOARD_TOUR_STEPS[index];
  const destination = step.path || tankPath || '/admin/tanks';
  const final = index === DASHBOARD_TOUR_STEPS.length - 1;

  useEffect(() => {
    if (location.pathname !== destination) navigate(destination, { replace: true });
  }, [destination, location.pathname, navigate]);

  useEffect(() => {
    const previous = focusBeforeTour.current;
    const shell = document.querySelector('.admin-dashboard-shell');
    const wasInert = shell?.hasAttribute('inert');
    shell?.setAttribute('inert', '');
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      if (!wasInert) shell?.removeAttribute('inert');
      document.body.style.overflow = overflow;
      const fallback = document.querySelector('[data-tour="replay-tour"]') || document.querySelector('.modern-admin-content');
      (previous?.isConnected ? previous : fallback)?.focus({ preventScroll: true });
    };
  }, [focusBeforeTour]);

  useEffect(() => {
    if (location.pathname !== destination) return;
    let frame, scrolled = false;
    const measure = () => {
      const viewport = { width: window.innerWidth, height: window.innerHeight };
      const target = step.id === 'monitoring' && !tankPath ? null : document.querySelector(`[data-tour="${step.target}"]`);
      let bounds = target?.getBoundingClientRect();
      if (bounds?.width && bounds.height && !scrolled) {
        scrolled = true;
        if (bounds.top < 16 || bounds.bottom > viewport.height - 16) target.scrollIntoView({ block: 'center', behavior: 'instant' });
        bounds = target.getBoundingClientRect();
      }
      const rect = bounds?.width && bounds.height && bounds.right > 0 && bounds.left < viewport.width && bounds.bottom > 0 && bounds.top < viewport.height ? {
        left: Math.max(6, bounds.left - 5), top: Math.max(6, bounds.top - 5),
        right: Math.min(viewport.width - 6, bounds.right + 5), bottom: Math.min(viewport.height - 6, bounds.bottom + 5),
      } : null;
      const card = dialog.current?.getBoundingClientRect() || { width: 360, height: 300 };
      const position = tourCardPosition(rect, viewport, card);
      const next = { step: step.id, path: destination, rect, ...position };
      setLayout(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure); };
    const observer = new MutationObserver(schedule);
    // Only app content, not the portal: measuring must not observe its own styles.
    const shell = document.querySelector('.admin-dashboard-shell');
    if (shell) observer.observe(shell, { childList: true, subtree: true });
    const resize = new ResizeObserver(schedule);
    if (dialog.current) resize.observe(dialog.current);
    if (shell) resize.observe(shell);
    window.addEventListener('resize', schedule);
    window.addEventListener('scroll', schedule, true);
    schedule(); advanceButton.current?.focus();
    return () => { cancelAnimationFrame(frame); observer.disconnect(); resize.disconnect();
      window.removeEventListener('resize', schedule); window.removeEventListener('scroll', schedule, true); };
  }, [destination, location.pathname, step.id, step.target, tankPath]);

  function move(next) {
    if (next === 2 && !tankPath) setTankPath(tankTourPath(document.querySelector('[data-tour="tank-details-link"]')?.getAttribute('href')));
    setIndex(next);
  }
  function keyboard(event) {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); onClose(false); }
    if (event.key === 'Enter' && event.target.tagName !== 'BUTTON') { event.preventDefault(); if (final) onClose(true); else move(index + 1); }
    if (event.key === 'Tab') {
      const buttons = [...dialog.current.querySelectorAll('button:not(:disabled)')];
      const first = buttons[0], last = buttons.at(-1);
      if (event.shiftKey && (document.activeElement === first || !buttons.includes(document.activeElement))) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !buttons.includes(document.activeElement))) { event.preventDefault(); first.focus(); }
    }
  }
  const measured = layout?.step === step.id && layout.path === location.pathname;
  const rect = measured ? layout.rect : null;
  return createPortal(<div className="dashboard-tour-layer" onKeyDown={keyboard}>
    <div className={`dashboard-tour-shield ${rect ? '' : 'is-dimmed'}`} aria-hidden="true" />
    {rect && <div className="dashboard-tour-spotlight" data-testid="tour-spotlight" aria-hidden="true"
      style={{ left: rect.left, top: rect.top, width: rect.right - rect.left, height: rect.bottom - rect.top }} />}
    <section className="dashboard-tour-card" role="dialog" aria-modal="true" aria-labelledby="dashboard-tour-title" aria-describedby="dashboard-tour-description"
      tabIndex={-1} ref={dialog} style={measured ? { left: layout.left, top: layout.top } : undefined}>
      <div className="dashboard-tour-progress"><Compass size={18} aria-hidden="true" /><span aria-live="polite">{index + 1} of {DASHBOARD_TOUR_STEPS.length}</span></div>
      <h2 id="dashboard-tour-title" aria-live="polite">{step.title}</h2>
      <div id="dashboard-tour-description"><p>{step.text}</p>{step.detail && <p className="dashboard-tour-detail">{step.detail}</p>}
        {step.id === 'monitoring' && !tankPath && <p>No tank needs to be created for this tour. Open Tank Details after adding your own tank.</p>}</div>
      <div className="dashboard-tour-controls">
        <button type="button" onClick={() => onClose(false)}>Skip Tour</button>
        <div className="dashboard-tour-actions"><button type="button" disabled={index === 0} onClick={() => move(index - 1)}><ArrowLeft size={16} aria-hidden="true" />Back</button>
          <button type="button" ref={advanceButton} className="tour-primary" onClick={() => final ? onClose(true) : move(index + 1)}>{final ? 'Finish Tour' : 'Next'}<ArrowRight size={16} aria-hidden="true" /></button></div>
      </div>
    </section>
  </div>, document.body);
}
