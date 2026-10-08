import { publicTankContract, resolveTankContract } from '../../src/utils/tankPlanningSchema.js';

export function tankContract(spec = tankSpec(), operation = 'create') {
  return publicTankContract(resolveTankContract(spec, { operation }));
}

// Hypothetical supported contract, not a claim about the production database.
export function tankSpec() {
  return { paths: { '/tanks': { post: {}, patch: {} } }, definitions: { tanks: {
    required: ['id', 'user_id', 'name', 'tank_type'], properties: {
      id: { type: 'string', format: 'uuid', default: 'gen_random_uuid()', description: 'Primary Key. <pk/>' },
      user_id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, tank_type: { type: 'string', enum: ['juvenile', 'breeder'] },
      length_cm: { type: 'number' }, width_cm: { type: 'number' }, height_cm: { type: 'number' }, normal_water_depth_cm: { type: 'number' },
      crayfish_count: { type: 'integer' }, shelter_count: { type: 'integer' }, notes: { type: 'string' },
      is_paired: { type: 'boolean', default: false }, device_uid: { type: 'string' },
    },
  } } };
}
