import { Construction, Sparkles } from "lucide-react";

export default function PlaceholderPage({ title, description }) {
  return (
    <section className="placeholder-page">
      <div className="placeholder-card">
        <span className="placeholder-icon">
          <Construction size={34} />
        </span>

        <p className="dashboard-eyebrow">Module Setup</p>
        <h2>{title}</h2>
        <p>{description}</p>

        <div className="placeholder-note">
          <Sparkles size={18} />
          <span>
            This module will be connected next after the dashboard overview is
            finalized.
          </span>
        </div>
      </div>
    </section>
  );
}