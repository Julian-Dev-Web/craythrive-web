import { Compass } from 'lucide-react';
import { useDashboardTour } from '../../context/DashboardTourContext';

export default function DashboardTourHelp() {
  const tour = useDashboardTour();
  return <section className="dashboard-tour-help cray-settings-panel" aria-labelledby="tour-help-title">
    <div><h2 id="tour-help-title"><Compass size={20} aria-hidden="true" />Help & Learning</h2>
      <p>Get to know the web dashboard with a short, optional tour. You can replay it anytime.</p></div>
    <button type="button" className="dashboard-primary-button" data-tour="replay-tour" onClick={tour?.startTour}>Take a Tour</button>
  </section>;
}
