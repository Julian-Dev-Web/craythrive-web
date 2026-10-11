import { formatSensorCardValue, formatSensorSafeRange } from '../utils/sensorSafeRanges';
import '../styles/sensorSafeRange.css';

export default function SensorSafeRange({ sensor, thresholds }) {
  if (!thresholds) return null;
  const text = formatSensorSafeRange(sensor, thresholds);
  return text ? <small className="sensor-safe-range">{text}</small> : null;
}

export function SensorReadingValue({ sensor, value }) {
  const text = formatSensorCardValue(value, sensor);
  const missing = text === 'No reading' || text === 'No recent ammonia reading';
  return <strong className={missing ? 'sensor-reading-empty' : undefined}>{text}</strong>;
}
