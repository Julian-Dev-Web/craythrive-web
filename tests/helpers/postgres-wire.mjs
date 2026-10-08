import postgres from 'postgres';

// PGlite normally accepts JSON strings without Postgres.js's wire serialization.
// Exercise the pinned production driver's real serializers for explicitly cast
// parameters, so tests catch accidental double encoding of raw JSON row text.
// Creating the client is lazy; this helper never opens a network connection.
const driver = postgres({ host: '127.0.0.1' });
export function postgresWireParameters(query, parameters = []) {
  return parameters.map((value, index) => {
    const cast = query.match(new RegExp(`\\$${index + 1}::(jsonb|text)\\b`, 'i'))?.[1].toLowerCase();
    if (value == null || !cast) return value;
    return driver.options.serializers[cast === 'jsonb' ? 3802 : 25](value);
  });
}
