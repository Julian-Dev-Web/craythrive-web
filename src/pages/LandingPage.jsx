import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BarChart3,
  Database,
  Download,
  Droplets,
  FlaskConical,
  Gauge,
  LineChart,
  LockKeyhole,
  MonitorCog,
  ShoppingBag,
  Smartphone,
  Thermometer,
  Waves,
} from "lucide-react";
import { APP_INFO } from "../constants/theme";
import ContactKeys from "../components/ContactKeys";

const APK_DOWNLOAD_URL = "/downloads/craythrive.apk";

const readoutChips = [
  { icon: Thermometer, label: "Temperature" },
  { icon: FlaskConical, label: "pH" },
  { icon: Gauge, label: "Turbidity" },
  { icon: Waves, label: "Water Level" },
  { icon: Droplets, label: "Ammonia" },
];

const features = [
  {
    icon: Activity,
    title: "Tank Monitoring",
    description:
      "Track tank readings, water condition, tank status, and recent sensor updates from the CrayThrive ecosystem.",
  },
  {
    icon: AlertTriangle,
    title: "Smart Alerts",
    description:
      "Review warning signs from temperature, pH, turbidity, water level, ammonia readings, feeding, and pump activity.",
  },
  {
    icon: Smartphone,
    title: "Ammonia Reader",
    description:
      "Dip a LIANKAI test strip, scan it with your phone camera, and get an estimated ammonia range logged straight to your tank.",
  },
  {
    icon: ShoppingBag,
    title: "Crayfish Marketplace",
    description:
      "Handle crayfish-only listings, reservations, sellers, completed orders, and listing history.",
  },
];

function ImageWithFallback({ src, alt, className, fallbackText }) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className={`${className} image-fallback`}>
        <span>{fallbackText}</span>
      </div>
    );
  }

  return (
    <img
      src={src}
      alt={alt}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

function BellIcon() {
  return (
    <svg
      width="19"
      height="19"
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M15 17H9M18 9.5C18 6.46 15.76 4 12 4S6 6.46 6 9.5C6 15 4 16 4 16H20C20 16 18 15 18 9.5Z"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M10 20C10.4 20.6 11.1 21 12 21C12.9 21 13.6 20.6 14 20"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function LandingPage() {
  const [scrollY, setScrollY] = useState(0);
  const [pointer, setPointer] = useState({ x: 0, y: 0 });

  useEffect(() => {
    const handleScroll = () => setScrollY(window.scrollY);

    const handlePointerMove = (event) => {
      const x = (event.clientX / window.innerWidth - 0.5) * 2;
      const y = (event.clientY / window.innerHeight - 0.5) * 2;
      setPointer({ x, y });
    };

    handleScroll();

    window.addEventListener("scroll", handleScroll, { passive: true });
    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      window.removeEventListener("scroll", handleScroll);
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  const phoneOneStyle = useMemo(() => {
    const rotateX = Math.max(-7, Math.min(7, pointer.y * -5));
    const rotateY = Math.max(-12, Math.min(12, pointer.x * 8));
    const translateY = Math.max(-40, scrollY * -0.04);

    return {
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(${translateY}px)`,
    };
  }, [pointer, scrollY]);

  const phoneTwoStyle = useMemo(() => {
    const rotateX = Math.max(-6, Math.min(6, pointer.y * -3));
    const rotateY = Math.max(-10, Math.min(10, pointer.x * 5));
    const translateY = Math.max(-28, scrollY * -0.025);

    return {
      transform: `perspective(1000px) rotateX(${rotateX}deg) rotateY(${
        rotateY - 8
      }deg) translateY(${translateY}px)`,
    };
  }, [pointer, scrollY]);

  return (
    <main className="app-landing">
      <section id="home" className="hero-app-section cx-hero">
        <svg className="cx-hero-ripples" viewBox="0 0 1200 500" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0 120 Q300 60 600 120 T1200 120" stroke="#0f8f7f" strokeWidth="1" fill="none" opacity="0.35" />
          <path d="M0 220 Q300 160 600 220 T1200 220" stroke="#00d9c7" strokeWidth="1" fill="none" opacity="0.25" />
          <path d="M0 340 Q300 280 600 340 T1200 340" stroke="#b8472f" strokeWidth="1" fill="none" opacity="0.18" />
        </svg>
        <div className="hero-grid-bg" />
        <div className="hero-orb hero-orb-one" />
        <div className="hero-orb hero-orb-two" />
        <div className="hero-circle hero-circle-one" />
        <div className="hero-circle hero-circle-two" />

        <nav className="app-navbar">
          <Link to="/" className="app-brand">
            <span className="app-brand-logo-wrap">
              <ImageWithFallback
                src={APP_INFO.logoPath}
                alt={`${APP_INFO.name} logo`}
                className="app-brand-logo"
                fallbackText="CT"
              />
            </span>
            <span>{APP_INFO.name}</span>
          </Link>

          <div className="app-nav-links">
            <a href="#home">Home</a>
            <a href="#features">Features</a>
            <a href="#details">Details</a>
            <a href={APK_DOWNLOAD_URL} download className="nav-login-pill">
              Get App
            </a>
            <Link to="/login" className="nav-login-pill">
              Login
            </Link>
          </div>
        </nav>

        <div className="app-hero-content cx-hero-content">
          <div className="app-hero-copy cx-hero-copy">
            <p className="cx-eyebrow">Built for small-scale crayfish keepers</p>

            <h1>A clearer read on every tank you keep.</h1>

            <p>
              CrayThrive pairs an app in your pocket with sensors in the tank —
              temperature, pH, turbidity, water level, and ammonia, logged
              automatically and flagged the moment something drifts.
            </p>

            <div className="hero-buttons">
              <a href={APK_DOWNLOAD_URL} download className="store-button">
                <Download size={18} />
                Get Our Mobile App
              </a>

              <a href="#features" className="learn-button">
                Learn More
                <ArrowRight size={18} />
              </a>
            </div>

            <div className="cx-hero-readout">
              {readoutChips.map((chip) => {
                const Icon = chip.icon;

                return (
                  <span className="cx-readout-chip" key={chip.label}>
                    <Icon size={15} />
                    {chip.label}
                  </span>
                );
              })}
            </div>
          </div>

          <div className="phone-showcase">
            <div className="phone-back-glow" />

            <div className="phone-float phone-float-main" style={phoneOneStyle}>
              <div className="phone phone-main">
                <div className="phone-speaker" />
                <div className="phone-screen">
                  <ImageWithFallback
                    src="/mobile-dashboard.png"
                    alt="CrayThrive mobile dashboard screen"
                    className="phone-screen-img"
                    fallbackText="Add public/mobile-dashboard.png"
                  />
                </div>
              </div>
            </div>

            <div
              className="phone-float phone-float-secondary"
              style={phoneTwoStyle}
            >
              <div className="phone phone-secondary">
                <div className="phone-speaker small" />
                <div className="phone-screen">
                  <ImageWithFallback
                    src="/mobile-welcome.png"
                    alt="CrayThrive mobile welcome screen"
                    className="phone-screen-img"
                    fallbackText="Add public/mobile-welcome.png"
                  />
                </div>
              </div>
            </div>

            <div className="floating-card floating-card-one">
              <Droplets size={19} />
              <span>Tank readings</span>
            </div>

            <div className="floating-card floating-card-two">
              <BellIcon />
              <span>Smart alerts</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="app-section cx-section cx-features">
        <div className="cx-features-head">
          <h2>Everything needed for tank care and records management.</h2>
          <p>
            The mobile app focuses on daily tank use, while the web dashboard
            gives deeper visibility for monitoring, reports, seller records, and
            marketplace activity.
          </p>
        </div>

        <div className="cx-feature-list">
          {features.map((feature) => {
            const Icon = feature.icon;

            return (
              <article className="cx-feature-row" key={feature.title}>
                <div className="cx-feature-icon">
                  <Icon size={24} />
                </div>
                <div>
                  <h3>{feature.title}</h3>
                  <p>{feature.description}</p>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      <section id="details" className="app-section cx-section cx-details">
        <div className="details-copy cx-details-copy">
          <h2>Built for the website and mobile app ecosystem.</h2>
          <p>
            The web dashboard handles tank monitoring reports, alerts,
            marketplace records, reservations, seller profiles, analytics, and
            threshold settings — using the same Supabase database as the
            mobile application.
          </p>

          <div className="cx-details-list">
            <div>
              <Database size={20} />
              <span>Shared Supabase database</span>
            </div>
            <div>
              <LockKeyhole size={20} />
              <span>Protected login access</span>
            </div>
            <div>
              <LineChart size={20} />
              <span>Reports and analytics ready</span>
            </div>
          </div>

          <Link to="/login" className="cx-details-login">
            Continue to Login
            <ArrowRight size={18} />
          </Link>
        </div>

        <div className="cx-tank-card">
          <div className="cx-tank-card-head">
            <strong>Tank 02 — Log</strong>
            <span className="cx-tank-card-tag">Stable</span>
          </div>

          <div className="cx-tank-card-rows">
            <div className="cx-tank-card-row">
              <span>Temp</span>
              <i><b style={{ width: "92%" }} /></i>
            </div>
            <div className="cx-tank-card-row">
              <span>pH</span>
              <i><b style={{ width: "76%" }} /></i>
            </div>
            <div className="cx-tank-card-row">
              <span>Turbidity</span>
              <i><b style={{ width: "58%" }} /></i>
            </div>
          </div>

          <div className="cx-tank-card-grid">
            <div>
              <Activity size={20} />
              <strong>Tank Reports</strong>
              <span>Sensor trends</span>
            </div>
            <div>
              <AlertTriangle size={20} />
              <strong>Alerts</strong>
              <span>Active warnings</span>
            </div>
            <div>
              <ShoppingBag size={20} />
              <strong>Orders</strong>
              <span>Reservations</span>
            </div>
            <div>
              <BarChart3 size={20} />
              <strong>Analytics</strong>
              <span>History records</span>
            </div>
          </div>
        </div>
      </section>

      <section id="download" className="bottom-cta-app">
        <MonitorCog size={42} />
        <h2>Get the CrayThrive Android app.</h2>
        <p>
          Download the Android APK to monitor tanks, view readings, manage
          marketplace activity, and connect with the CrayThrive web dashboard.
        </p>

        <div className="hero-buttons">
          <a href={APK_DOWNLOAD_URL} download className="store-button">
            <Download size={18} />
            Download Android APK
          </a>

          <Link to="/login" className="learn-button">
            Login to Web
            <ArrowRight size={18} />
          </Link>
        </div>
      </section>

      <section id="contact" className="contact-app-section">
        <h2>Get in touch</h2>
        <p>
          Questions about your tanks, the app, or setting up your own CrayThrive
          system? Reach us through either channel below.
        </p>

        <ContactKeys />
      </section>

      <footer className="app-footer">
        <div className="footer-brand-app">
          <span className="footer-logo-wrap">
            <ImageWithFallback
              src={APP_INFO.logoPath}
              alt={`${APP_INFO.name} logo`}
              className="footer-brand-logo"
              fallbackText="CT"
            />
          </span>

          <div>
            <strong>{APP_INFO.name}</strong>
            <span>{APP_INFO.domain}</span>
          </div>
        </div>

        <p>© 2026 CrayThrive. All rights reserved.</p>
      </footer>
    </main>
  );
}