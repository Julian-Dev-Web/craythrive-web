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
  LineChart,
  LockKeyhole,
  Mail,
  MonitorCog,
  Phone,
  ShoppingBag,
  Smartphone,
} from "lucide-react";
import { APP_INFO } from "../constants/theme";

const APK_DOWNLOAD_URL = "https://abtzkqfrwzcocyrwcrfc.supabase.co/storage/v1/object/public/app-downloads/craythrive.apk";

// >>> EDIT THESE TWO VALUES WITH YOUR REAL CONTACT INFO <<<
const CONTACT_EMAIL = "Craythrivesupport@gmail.com";
const CONTACT_PHONE = "+63 935 819 6510";

const previewStats = [
  {
    icon: Droplets,
    label: "Water Quality",
    value: "Live Monitoring",
  },
  {
    icon: FlaskConical,
    label: "Ammonia",
    value: "Camera-Assisted",
  },
  {
    icon: ShoppingBag,
    label: "Marketplace",
    value: "Crayfish Only",
  },
];

const features = [
  {
    icon: Activity,
    title: "Tank Monitoring",
    description:
      "Track tank readings, water condition, tank status, and recent sensor updates from the CrayThrive ecosystem.",
    accent: "teal",
  },
  {
    icon: AlertTriangle,
    title: "Alerts",
    description:
      "Review warning signs from temperature, pH, turbidity, water level, ammonia readings, feeding, and pump activity.",
    accent: "amber",
  },
  {
    icon: Smartphone,
    title: "Ammonia Reader",
    description:
      "Dip a LIANKAI test strip, scan it with your phone camera, and get an estimated ammonia range logged to your tank.",
    accent: "cyan",
  },
  {
    icon: ShoppingBag,
    title: "Crayfish Marketplace",
    description:
      "Handle crayfish-only listings, reservations, sellers, completed orders, and listing history.",
    accent: "blue",
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

function FooterContactIcon({ icon: Icon, label, value }) {
  const [isHovering, setIsHovering] = useState(false);
  const [justCopied, setJustCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(value);
      setJustCopied(true);
      window.setTimeout(() => setJustCopied(false), 1600);
    } catch {
      // Clipboard API unavailable (very old browser or non-HTTPS) — the
      // tooltip already shows the value on hover, so it's still visible.
    }
  };

  return (
    <button
      type="button"
      className="footer-icon-link"
      aria-label={`Copy ${label.toLowerCase()}: ${value}`}
      onMouseEnter={() => setIsHovering(true)}
      onMouseLeave={() => setIsHovering(false)}
      onFocus={() => setIsHovering(true)}
      onBlur={() => setIsHovering(false)}
      onClick={handleCopy}
    >
      <Icon size={18} />
      <span className={`footer-icon-tip ${isHovering ? "is-visible" : ""}`}>
        {justCopied ? "Copied!" : value}
      </span>
    </button>
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
      <section id="home" className="hero-app-section">
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

        <div className="app-hero-content">
          <div className="app-hero-copy">
            <h1>
              MOBILE APP <br />
              FOR <span>CRAYFISH KEEPERS</span>
            </h1>

            <p>
              CrayThrive helps users monitor crayfish tanks, check water
              quality, track ammonia readings, manage alerts, and access
              crayfish-only marketplace records.
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

            <div className="hero-mini-stats">
              {previewStats.map((item) => {
                const Icon = item.icon;

                return (
                  <div className="hero-mini-stat" key={item.label}>
                    <Icon size={20} />
                    <div>
                      <strong>{item.value}</strong>
                      <span>{item.label}</span>
                    </div>
                  </div>
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
              <span> alerts</span>
            </div>
          </div>
        </div>
      </section>

      <section id="features" className="app-section features-app-section">
        <div className="section-heading">
          <span>Features</span>
          <h2>Everything needed for tank care and records management.</h2>
          <p>
            The mobile app focuses on daily tank use, while the web dashboard
            gives deeper visibility for monitoring, reports, seller records, and
            marketplace activity.
          </p>
        </div>

        <div className="feature-app-grid">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            const lift = Math.max(0, scrollY - 520) * 0.018;
            const rotate = (index % 2 === 0 ? 1 : -1) * Math.min(5, lift);

            return (
              <article
                className={`feature-app-card accent-${feature.accent}`}
                key={feature.title}
                style={{
                  transform: `perspective(900px) rotateX(${rotate}deg) translateY(${
                    index % 2 === 0 ? 0 : 18
                  }px)`,
                }}
              >
                <div className="feature-app-icon">
                  <Icon size={26} />
                </div>
                <h3>{feature.title}</h3>
                <p>{feature.description}</p>
              </article>
            );
          })}
        </div>
      </section>

      <section id="details" className="app-section details-section">
        <div className="details-copy">
          <span className="section-label">Dashboard Side</span>
          <h2>Built for the website and mobile app ecosystem.</h2>
          <p>
            The web dashboard will handle tank monitoring reports, alerts,
            marketplace records, reservations, seller profiles, analytics, and
            threshold settings while using the same Supabase database as the
            mobile application.
          </p>

          <div className="details-list">
            <div>
              <Database size={22} />
              <span>Shared Supabase database</span>
            </div>
            <div>
              <LockKeyhole size={22} />
              <span>Protected login access</span>
            </div>
            <div>
              <LineChart size={22} />
              <span>Reports and analytics ready</span>
            </div>
          </div>

          <Link to="/login" className="details-login-button">
            Continue to Login
            <ArrowRight size={18} />
          </Link>
        </div>

        <div className="details-dashboard-card">
          <div className="dashboard-card-header">
            <div>
              <span />
              <span />
              <span />
            </div>
            <strong>CrayThrive Web</strong>
          </div>

          <div className="dashboard-bars">
            <div style={{ width: "92%" }} />
            <div style={{ width: "76%" }} />
            <div style={{ width: "58%" }} />
          </div>

          <div className="dashboard-preview-grid">
            <div>
              <Activity size={22} />
              <strong>Tank Reports</strong>
              <span>Sensor trends</span>
            </div>
            <div>
              <AlertTriangle size={22} />
              <strong>Alerts</strong>
              <span>Active warnings</span>
            </div>
            <div>
              <ShoppingBag size={22} />
              <strong>Orders</strong>
              <span>Reservations</span>
            </div>
            <div>
              <BarChart3 size={22} />
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

        <div className="footer-right-group">
          <div className="footer-contact-icons">
            <FooterContactIcon icon={Mail} label="Email" value={CONTACT_EMAIL} />
            <FooterContactIcon icon={Phone} label="Phone" value={CONTACT_PHONE} />
          </div>

          <p>© 2026 CrayThrive. All rights reserved.</p>
        </div>
      </footer>
    </main>
  );
}