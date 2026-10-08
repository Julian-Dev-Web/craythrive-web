import { createClient } from 'npm:@supabase/supabase-js@2.105.4';
import { createSupabaseTokenVerifier } from './developerAuthorization.js';
import { createDeveloperHandler } from './developerHandlers.js';
import postgres from 'npm:postgres@3.4.8';
import { createArchiveCodec, createBackupOperation, DeveloperOperationError } from './developerBackup.js';
import { createDeveloperDatabase } from './developerDatabase.js';

export function serveDeveloperFunction(purpose) {
  const readSecret = name => Deno.env.get(name);
  const operation = purpose === 'access' ? undefined : async context => {
    const connectionString = readSecret('SUPABASE_DB_URL');
    if (!connectionString) throw new DeveloperOperationError('Backup server configuration is incomplete.', 503);
    const codec = createArchiveCodec({ secret: readSecret('CRAYTHRIVE_BACKUP_ENCRYPTION_KEY'), project: readSecret('SUPABASE_URL') });
    const sql = postgres(connectionString, { prepare: false, max: 1, connect_timeout: 10, idle_timeout: 1, ssl: 'require' });
    try {
      const result = await createBackupOperation({ purpose, codec, database: createDeveloperDatabase(sql) })(context);
      // Metadata only: no row contents, archive ciphertext, OTPs or credentials.
      console.info(JSON.stringify({ event: 'developer_data_operation_completed', action: result.restored ? 'restore' : result.previewToken ? 'preview' : 'backup', tables: result.tables.length }));
      return result;
    } finally { await sql.end({ timeout: 5 }); }
  };
  Deno.serve(createDeveloperHandler({ purpose, readSecret, operation, verifyToken: createSupabaseTokenVerifier(createClient, readSecret) }));
}
