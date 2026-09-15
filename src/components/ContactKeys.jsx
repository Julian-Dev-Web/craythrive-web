import { useState } from "react";
import { Mail, Phone } from "lucide-react";

/**
 * "CONTACT" keyboard-key animation for the landing page footer.
 *
 * Recreated from a reference clip (TikTok @settigation) using the HTML/CSS
 * structure the user shared as a guide:
 *   .key            -> one physical key (list item)
 *   .key__cap       -> the part that lifts/rotates
 *   .key__face      -> front (letter) and back (icon) faces of the cap,
 *                      composited with `backface-visibility: hidden`
 * The 7 letters of CONTACT are static decorative keycaps (press animation
 * only). The 2 action keys (Email, Phone) use the flip: front face shows
 * nothing but a glow, back face shows the icon, and hovering/tapping
 * rotates the cap 180° on the Y axis to reveal it, exactly like the
 * reference. Real links are declared in CONTACT_CHANNELS below.
 *
 * >>> EDIT THESE TWO VALUES WITH YOUR REAL CONTACT INFO <<<
 */
const CONTACT_CHANNELS = [
  {
    id: "email",
    label: "Email",
    icon: Mail,
    href: "mailto:Craythrivesupport@gmail.com", // <-- replace with real email
  },
  {
    id: "phone",
    label: "Call",
    icon: Phone,
    href: "tel:+639358196510", // <-- replace with real phone number
  },
];

const LETTERS = "CONTACT".split("");

function LetterKey({ letter, index }) {
  return (
    <li className="ck-key ck-key--letter" style={{ "--i": index }}>
      <span className="ck-key__glow" />
      <span className="ck-key__cap">
        <span className="ck-key__face ck-key__face--letter">{letter}</span>
      </span>
    </li>
  );
}

function ActionKey({ channel, index }) {
  const [isActive, setIsActive] = useState(false);
  const Icon = channel.icon;

  return (
    <li
      className={`ck-key ck-key--action ${isActive ? "is-active" : ""}`}
      style={{ "--i": index }}
      onMouseEnter={() => setIsActive(true)}
      onMouseLeave={() => setIsActive(false)}
    >
      <span className="ck-key__glow" />
      <a
        className="ck-key__hit"
        href={channel.href}
        aria-label={channel.label}
        onFocus={() => setIsActive(true)}
        onBlur={() => setIsActive(false)}
        onClick={() => setIsActive(true)}
      >
        <span className="ck-key__cap">
          <span className="ck-key__face ck-key__face--letter" aria-hidden="true" />
          <span className="ck-key__face ck-key__face--icon">
            <Icon size={20} strokeWidth={2.2} />
          </span>
        </span>
      </a>

      <span className="ck-key__tip">{channel.label}</span>
    </li>
  );
}

export default function ContactKeys() {
  return (
    <div className="ck-dock-wrap">
      <ul className="ck-dock" role="list">
        {LETTERS.map((letter, index) => (
          <LetterKey key={`${letter}-${index}`} letter={letter} index={index} />
        ))}

        {CONTACT_CHANNELS.map((channel, index) => (
          <ActionKey key={channel.id} channel={channel} index={LETTERS.length + index} />
        ))}
      </ul>
    </div>
  );
}