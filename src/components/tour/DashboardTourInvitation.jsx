import { Compass } from 'lucide-react';
import { useDashboardTour } from '../../context/DashboardTourContext';

export default function DashboardTourInvitation() {
  const tour = useDashboardTour();
  if (!tour?.invitation) return null;
  const first = tour.invitation.kind === 'first';
  return <section className={`dashboard-tour-invitation ${first ? 'is-first' : ''}`} aria-labelledby="tour-invitation-title">
    <Compass size={22} aria-hidden="true" />
    <div><h2 id="tour-invitation-title">{first ? 'Welcome to CrayThrive' : 'Welcome back!'}</h2>
      <p>{first ? 'New to the dashboard? Take a quick tour to learn the main features.' : 'Need a quick refresher?'}</p></div>
    <div className="dashboard-tour-actions">
      <button type="button" className="tour-primary" onClick={tour.startTour}>Take a Tour</button>
      <button type="button" onClick={tour.dismissInvitation}>{first ? 'Skip for Now' : 'Maybe Later'}</button>
    </div>
  </section>;
}
