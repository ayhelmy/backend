'use strict';

const { pool } = require('../../config/database');

const SimulationStepModel = {

  /** All steps for a simulation, ordered by step_order ascending. */
  async findBySimulationId(simulationId) {
    const { rows } = await pool.query(
      `SELECT id, simulation_id, step_order, label, category_name, created_at, updated_at
         FROM simulation_steps
        WHERE simulation_id = $1
        ORDER BY step_order ASC`,
      [simulationId],
    );
    return rows;
  },

  /**
   * Replace all steps for a simulation in a single transaction.
   * steps = [{ stepOrder, label, categoryName }, ...]
   */
  async replaceSteps(simulationId, steps) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'DELETE FROM simulation_steps WHERE simulation_id = $1',
        [simulationId],
      );
      if (steps.length > 0) {
        const values = steps.map((s, i) => {
          const base = i * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        }).join(', ');
        const params = steps.flatMap(s => [simulationId, s.stepOrder, s.label, s.categoryName]);
        await client.query(
          `INSERT INTO simulation_steps (simulation_id, step_order, label, category_name)
           VALUES ${values}`,
          params,
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    return this.findBySimulationId(simulationId);
  },
};

module.exports = SimulationStepModel;
