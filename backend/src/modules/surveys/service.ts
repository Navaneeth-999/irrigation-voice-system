import { db, withTransaction } from '../../db/index.js';
import { analyticsService } from '../analytics/service.js';
import {
  FieldSurvey,
  CreateSurveyDTO,
  UpdateSurveyDTO,
  SurveyAuditLog,
  SurveyComparison,
  RainfallSource,
  WaterAvailabilityStatus,
  CropCondition,
  MeasurementSource,
  DataOrigin,
} from './types.js';

export class SurveyService {
  /**
   * Helper to compute water volumes from pump specs, duration, and irrigation depth.
   */
  calculateWaterMetrics(input: {
    areaAcres?: number | null;
    pumpDischargeLps?: number | null;
    pumpHoursPerEvent?: number | null;
    irrigationDurationHours?: number | null;
    irrigationDepthMm?: number | null;
    appliedWaterVolumeM3?: number | null;
    appliedWaterLitres?: number | null;
  }): {
    appliedWaterVolumeM3: number | null;
    appliedWaterLitres: number | null;
    irrigationDepthMm: number | null;
  } {
    let volumeM3 = input.appliedWaterVolumeM3 !== undefined && input.appliedWaterVolumeM3 !== null ? Number(input.appliedWaterVolumeM3) : null;
    let volumeLitres = input.appliedWaterLitres !== undefined && input.appliedWaterLitres !== null ? Number(input.appliedWaterLitres) : null;
    let depthMm = input.irrigationDepthMm !== undefined && input.irrigationDepthMm !== null ? Number(input.irrigationDepthMm) : null;
    const areaAcres = input.areaAcres ? Number(input.areaAcres) : null;

    const hours = input.pumpHoursPerEvent ?? input.irrigationDurationHours ?? null;
    const lps = input.pumpDischargeLps ? Number(input.pumpDischargeLps) : null;

    // 1. If explicit volume is provided
    if (volumeM3 !== null && volumeLitres === null) {
      volumeLitres = volumeM3 * 1000;
    } else if (volumeLitres !== null && volumeM3 === null) {
      volumeM3 = volumeLitres / 1000;
    }

    // 2. Derive from pump discharge & hours if volume is not explicitly provided
    if (volumeM3 === null && lps !== null && hours !== null && hours > 0) {
      volumeLitres = lps * hours * 3600;
      volumeM3 = volumeLitres / 1000;
    }

    // 3. Derive from depth mm and area acres if volume still not available
    if (volumeM3 === null && depthMm !== null && areaAcres !== null && areaAcres > 0) {
      // 1 acre = 4046.86 m2; depth_m = depthMm / 1000
      volumeM3 = areaAcres * 4046.86 * (depthMm / 1000);
      volumeLitres = volumeM3 * 1000;
    }

    // 4. Back-calculate depth mm if volume & area are available but depth is missing
    if (depthMm === null && volumeM3 !== null && areaAcres !== null && areaAcres > 0) {
      depthMm = (volumeM3 / (areaAcres * 4046.86)) * 1000;
    }

    return {
      appliedWaterVolumeM3: volumeM3 !== null ? Math.round(volumeM3 * 100) / 100 : null,
      appliedWaterLitres: volumeLitres !== null ? Math.round(volumeLitres * 100) / 100 : null,
      irrigationDepthMm: depthMm !== null ? Math.round(depthMm * 100) / 100 : null,
    };
  }

  /**
   * Records a new field survey visit.
   * Directly updates seasonal metrics and feeds into water analytics when linked to a season.
   */
  async createSurvey(
    dto: CreateSurveyDTO,
    user?: { id: string; role: string },
    scopedVillages: string[] | null = null
  ): Promise<FieldSurvey> {
    // 1. Validate farmer and determine village
    const farmerRes = await db.query(
      `SELECT f.id, f.full_name as name, f.farmer_code, f.village_id, f.data_origin,
              v.name as village_name
       FROM farmers f
       JOIN villages v ON v.id = f.village_id
       WHERE f.id = $1`,
      [dto.farmerId]
    );

    if (farmerRes.rows.length === 0) {
      throw new Error(`Farmer ${dto.farmerId} not found`);
    }

    const farmer = farmerRes.rows[0];
    const villageId = dto.villageId || farmer.village_id;

    if (scopedVillages !== null && !scopedVillages.includes(villageId)) {
      throw new Error('Forbidden: Cannot record surveys outside assigned village scope');
    }

    // 2. Identify season if not specified
    let seasonId = dto.seasonId || null;
    let cropId = dto.cropId || null;
    let plotId = dto.plotId || null;

    if (!seasonId) {
      const activeSeasonRes = await db.query(
        `SELECT id, crop_id, plot_id, area_acres_snapshot
         FROM seasons
         WHERE farmer_id = $1 AND status IN ('active', 'monitoring')
           AND sowing_date <= $2 AND expected_harvest_date >= $2
         ORDER BY sowing_date DESC LIMIT 1`,
        [dto.farmerId, dto.surveyDate]
      );
      if (activeSeasonRes.rows.length > 0) {
        seasonId = activeSeasonRes.rows[0].id;
        if (!cropId) cropId = activeSeasonRes.rows[0].crop_id;
        if (!plotId) plotId = activeSeasonRes.rows[0].plot_id;
      }
    }

    // 3. Calculate water volumes
    const water = this.calculateWaterMetrics({
      areaAcres: dto.areaAcres,
      pumpDischargeLps: dto.pumpDischargeLps,
      pumpHoursPerEvent: dto.pumpHoursPerEvent,
      irrigationDurationHours: dto.irrigationDurationHours,
      irrigationDepthMm: dto.irrigationDepthMm,
      appliedWaterVolumeM3: dto.appliedWaterVolumeM3,
      appliedWaterLitres: dto.appliedWaterLitres,
    });

    const dataOrigin: DataOrigin = dto.dataOrigin || (farmer.data_origin === 'demo' ? 'demo' : 'real');

    // 4. Insert Survey
    const insertRes = await db.query(
      `INSERT INTO field_surveys (
        farmer_id, village_id, plot_id, season_id, survey_date, survey_period,
        crop_id, crop_stage_id, area_acres, soil_type,
        water_source_type_id, irrigation_method_type_id,
        irrigation_frequency_days, irrigation_duration_hours,
        pump_discharge_lps, pump_hours_per_event, irrigation_depth_mm,
        applied_water_volume_m3, applied_water_litres,
        rainfall_mm, rainfall_source, water_availability_status, crop_condition,
        crop_yield_quantity, crop_yield_unit, crop_sale_price_per_unit, cultivation_expenses_inr,
        farmer_remarks, surveyor_name, measurement_source, data_origin,
        version, is_correction, created_by, updated_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6,
        $7, $8, $9, $10,
        $11, $12,
        $13, $14,
        $15, $16, $17,
        $18, $19,
        $20, $21, $22, $23,
        $24, $25, $26, $27,
        $28, $29, $30, $31,
        1, FALSE, $32, $32
      ) RETURNING *`,
      [
        dto.farmerId,
        villageId,
        plotId,
        seasonId,
        dto.surveyDate,
        dto.surveyPeriod || 'monthly',
        cropId,
        dto.cropStageId || null,
        dto.areaAcres || null,
        dto.soilType || null,
        dto.waterSourceTypeId || null,
        dto.irrigationMethodTypeId || null,
        dto.irrigationFrequencyDays || null,
        dto.irrigationDurationHours || null,
        dto.pumpDischargeLps || null,
        dto.pumpHoursPerEvent || null,
        water.irrigationDepthMm,
        water.appliedWaterVolumeM3,
        water.appliedWaterLitres,
        dto.rainfallMm !== undefined && dto.rainfallMm !== null ? dto.rainfallMm : null,
        dto.rainfallSource || 'farmer_reported',
        dto.waterAvailabilityStatus || 'adequate',
        dto.cropCondition || 'good',
        dto.cropYieldQuantity !== undefined && dto.cropYieldQuantity !== null ? dto.cropYieldQuantity : null,
        dto.cropYieldUnit || null,
        dto.cropSalePricePerUnit !== undefined && dto.cropSalePricePerUnit !== null ? dto.cropSalePricePerUnit : null,
        dto.cultivationExpensesInr !== undefined && dto.cultivationExpensesInr !== null ? dto.cultivationExpensesInr : null,
        dto.farmerRemarks || null,
        dto.surveyorName || null,
        dto.measurementSource || 'fieldwork_measured',
        dataOrigin,
        user?.id || null,
      ]
    );

    const surveyRow = insertRes.rows[0];

    // 5. Create initial audit log entry
    await db.query(
      `INSERT INTO field_survey_audit_logs (
        survey_id, action, changed_by, reason, new_data
      ) VALUES ($1, 'create', $2, 'Initial field survey record creation', $3)`,
      [surveyRow.id, user?.id || null, JSON.stringify(surveyRow)]
    );

    // 6. Connect to water analytics & season records if season is linked
    if (seasonId) {
      if (water.appliedWaterLitres && water.appliedWaterLitres > 0) {
        await db.query(
          `INSERT INTO irrigation_records (
            season_id, period_start, period_end, event_count,
            raw_value, raw_unit, calculation_method,
            estimated_volume_l, estimated_depth_mm,
            measurement_type, source, is_simulated, notes
          ) VALUES ($1, $2, $2, 1, $3, $4, $5, $6, $7, 'measured', 'field_visit', $8, $9)`,
          [
            seasonId,
            dto.surveyDate,
            dto.pumpHoursPerEvent || dto.irrigationDurationHours || water.appliedWaterVolumeM3 || 1,
            dto.pumpHoursPerEvent ? 'pump_hours' : 'litres',
            dto.pumpDischargeLps ? 'pump_hours_x_discharge' : 'manual_estimate',
            water.appliedWaterLitres,
            water.irrigationDepthMm,
            dataOrigin === 'demo',
            `Recorded via Field Survey #${surveyRow.id.substring(0, 8)} by ${dto.surveyorName || 'CSP Member'}`,
          ]
        );
      }

      // Update season yield if provided on the survey and currently empty
      if (dto.cropYieldQuantity && dto.cropYieldQuantity > 0) {
        await db.query(
          `UPDATE seasons
           SET yield_value = COALESCE(yield_value, $1),
               yield_unit = COALESCE(yield_unit, $2),
               updated_at = NOW()
           WHERE id = $3`,
          [dto.cropYieldQuantity, dto.cropYieldUnit || 'kg', seasonId]
        );
      }

      // Trigger automatic recalculation of water analytics
      try {
        await analyticsService.recalculateSeasonWaterMetrics(seasonId);
      } catch (err: any) {
        console.warn(`[SurveyService] Note: recalculateSeasonWaterMetrics failed for season ${seasonId}:`, err.message);
      }
    }

    return this.getSurveyById(surveyRow.id, scopedVillages) as Promise<FieldSurvey>;
  }

  /**
   * Retrieves single survey with full associations.
   */
  async getSurveyById(id: string, scopedVillages: string[] | null): Promise<FieldSurvey | null> {
    const res = await db.query(
      `SELECT fs.*,
              f.full_name as farmer_name, f.farmer_code,
              v.name as village_name, v.mandal, v.district,
              p.label as plot_name,
              s.season_code, s.season_type, s.season_year,
              c.name as crop_name,
              cs.name as crop_stage_name,
              wst.name as water_source_name,
              imt.name as irrigation_method_name,
              u.name as created_by_name
       FROM field_surveys fs
       JOIN farmers f ON f.id = fs.farmer_id
       JOIN villages v ON v.id = fs.village_id
       LEFT JOIN plots p ON p.id = fs.plot_id
       LEFT JOIN seasons s ON s.id = fs.season_id
       LEFT JOIN crops c ON c.id = fs.crop_id
       LEFT JOIN crop_stages cs ON cs.id = fs.crop_stage_id
       LEFT JOIN water_source_types wst ON wst.id = fs.water_source_type_id
       LEFT JOIN irrigation_method_types imt ON imt.id = fs.irrigation_method_type_id
       LEFT JOIN users u ON u.id = fs.created_by
       WHERE fs.id = $1`,
      [id]
    );

    if (res.rows.length === 0) return null;

    const row = res.rows[0];
    if (scopedVillages !== null && !scopedVillages.includes(row.village_id)) {
      throw new Error('Forbidden: Access outside assigned village scope');
    }

    return this.mapSurveyRow(row);
  }

  /**
   * Lists surveys with filters and pagination.
   */
  async listSurveys(
    filter: {
      farmerId?: string;
      villageId?: string;
      seasonId?: string;
      startDate?: string;
      endDate?: string;
      dataOrigin?: string;
      page?: number;
      limit?: number;
    },
    scopedVillages: string[] | null
  ): Promise<{ data: FieldSurvey[]; total: number; page: number; limit: number; totalPages: number }> {
    const page = filter.page && filter.page > 0 ? filter.page : 1;
    const limit = filter.limit && filter.limit > 0 ? filter.limit : 20;
    const offset = (page - 1) * limit;

    const conditions: string[] = [];
    const params: any[] = [];
    let pIdx = 1;

    if (scopedVillages !== null) {
      conditions.push(`fs.village_id = ANY($${pIdx}::uuid[])`);
      params.push(scopedVillages);
      pIdx++;
    }

    if (filter.farmerId) {
      conditions.push(`fs.farmer_id = $${pIdx}`);
      params.push(filter.farmerId);
      pIdx++;
    }

    if (filter.villageId) {
      conditions.push(`fs.village_id = $${pIdx}`);
      params.push(filter.villageId);
      pIdx++;
    }

    if (filter.seasonId) {
      conditions.push(`fs.season_id = $${pIdx}`);
      params.push(filter.seasonId);
      pIdx++;
    }

    if (filter.dataOrigin) {
      conditions.push(`fs.data_origin = $${pIdx}`);
      params.push(filter.dataOrigin);
      pIdx++;
    }

    if (filter.startDate) {
      conditions.push(`fs.survey_date >= $${pIdx}`);
      params.push(filter.startDate);
      pIdx++;
    }

    if (filter.endDate) {
      conditions.push(`fs.survey_date <= $${pIdx}`);
      params.push(filter.endDate);
      pIdx++;
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const countRes = await db.query(`SELECT COUNT(*) as total FROM field_surveys fs ${whereClause}`, params);
    const total = parseInt(countRes.rows[0].total, 10) || 0;

    const listQuery = `
      SELECT fs.*,
             f.full_name as farmer_name, f.farmer_code,
             v.name as village_name, v.mandal, v.district,
             p.label as plot_name,
             s.season_code, s.season_type, s.season_year,
             c.name as crop_name,
             cs.name as crop_stage_name,
             wst.name as water_source_name,
             imt.name as irrigation_method_name,
             u.name as created_by_name
      FROM field_surveys fs
      JOIN farmers f ON f.id = fs.farmer_id
      JOIN villages v ON v.id = fs.village_id
      LEFT JOIN plots p ON p.id = fs.plot_id
      LEFT JOIN seasons s ON s.id = fs.season_id
      LEFT JOIN crops c ON c.id = fs.crop_id
      LEFT JOIN crop_stages cs ON cs.id = fs.crop_stage_id
      LEFT JOIN water_source_types wst ON wst.id = fs.water_source_type_id
      LEFT JOIN irrigation_method_types imt ON imt.id = fs.irrigation_method_type_id
      LEFT JOIN users u ON u.id = fs.created_by
      ${whereClause}
      ORDER BY fs.survey_date DESC, fs.created_at DESC
      LIMIT $${pIdx} OFFSET $${pIdx + 1}
    `;

    const listRes = await db.query(listQuery, [...params, limit, offset]);

    return {
      data: listRes.rows.map((r) => this.mapSurveyRow(r)),
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  /**
   * Corrects an existing survey while preserving audit trail and incrementing version.
   */
  async correctSurvey(
    id: string,
    dto: UpdateSurveyDTO,
    user: { id: string; role: string },
    scopedVillages: string[] | null
  ): Promise<FieldSurvey> {
    if (!dto.correctionReason || !dto.correctionReason.trim()) {
      throw new Error('Mandatory correctionReason is required for updating or correcting a field survey');
    }

    const existingRes = await db.query(`SELECT * FROM field_surveys WHERE id = $1`, [id]);
    if (existingRes.rows.length === 0) {
      throw new Error(`Survey ${id} not found`);
    }

    const prev = existingRes.rows[0];
    if (scopedVillages !== null && !scopedVillages.includes(prev.village_id)) {
      throw new Error('Forbidden: Access outside assigned village scope');
    }

    // Recompute water measurements
    const water = this.calculateWaterMetrics({
      areaAcres: dto.areaAcres !== undefined ? dto.areaAcres : prev.area_acres,
      pumpDischargeLps: dto.pumpDischargeLps !== undefined ? dto.pumpDischargeLps : prev.pump_discharge_lps,
      pumpHoursPerEvent: dto.pumpHoursPerEvent !== undefined ? dto.pumpHoursPerEvent : prev.pump_hours_per_event,
      irrigationDurationHours: dto.irrigationDurationHours !== undefined ? dto.irrigationDurationHours : prev.irrigation_duration_hours,
      irrigationDepthMm: dto.irrigationDepthMm !== undefined ? dto.irrigationDepthMm : prev.irrigation_depth_mm,
      appliedWaterVolumeM3: dto.appliedWaterVolumeM3 !== undefined ? dto.appliedWaterVolumeM3 : prev.applied_water_volume_m3,
      appliedWaterLitres: dto.appliedWaterLitres !== undefined ? dto.appliedWaterLitres : prev.applied_water_litres,
    });

    const newVersion = (prev.version || 1) + 1;

    const updateRes = await db.query(
      `UPDATE field_surveys
       SET survey_date = COALESCE($1, survey_date),
           survey_period = COALESCE($2, survey_period),
           crop_id = COALESCE($3, crop_id),
           crop_stage_id = COALESCE($4, crop_stage_id),
           area_acres = COALESCE($5, area_acres),
           soil_type = COALESCE($6, soil_type),
           water_source_type_id = COALESCE($7, water_source_type_id),
           irrigation_method_type_id = COALESCE($8, irrigation_method_type_id),
           irrigation_frequency_days = COALESCE($9, irrigation_frequency_days),
           irrigation_duration_hours = COALESCE($10, irrigation_duration_hours),
           pump_discharge_lps = COALESCE($11, pump_discharge_lps),
           pump_hours_per_event = COALESCE($12, pump_hours_per_event),
           irrigation_depth_mm = $13,
           applied_water_volume_m3 = $14,
           applied_water_litres = $15,
           rainfall_mm = COALESCE($16, rainfall_mm),
           rainfall_source = COALESCE($17, rainfall_source),
           water_availability_status = COALESCE($18, water_availability_status),
           crop_condition = COALESCE($19, crop_condition),
           crop_yield_quantity = COALESCE($20, crop_yield_quantity),
           crop_yield_unit = COALESCE($21, crop_yield_unit),
           crop_sale_price_per_unit = COALESCE($22, crop_sale_price_per_unit),
           cultivation_expenses_inr = COALESCE($23, cultivation_expenses_inr),
           farmer_remarks = COALESCE($24, farmer_remarks),
           surveyor_name = COALESCE($25, surveyor_name),
           measurement_source = COALESCE($26, measurement_source),
           version = $27,
           is_correction = TRUE,
           correction_reason = $28,
           updated_by = $29,
           updated_at = NOW()
       WHERE id = $30
       RETURNING *`,
      [
        dto.surveyDate || null,
        dto.surveyPeriod || null,
        dto.cropId || null,
        dto.cropStageId || null,
        dto.areaAcres !== undefined ? dto.areaAcres : null,
        dto.soilType || null,
        dto.waterSourceTypeId || null,
        dto.irrigationMethodTypeId || null,
        dto.irrigationFrequencyDays !== undefined ? dto.irrigationFrequencyDays : null,
        dto.irrigationDurationHours !== undefined ? dto.irrigationDurationHours : null,
        dto.pumpDischargeLps !== undefined ? dto.pumpDischargeLps : null,
        dto.pumpHoursPerEvent !== undefined ? dto.pumpHoursPerEvent : null,
        water.irrigationDepthMm,
        water.appliedWaterVolumeM3,
        water.appliedWaterLitres,
        dto.rainfallMm !== undefined ? dto.rainfallMm : null,
        dto.rainfallSource || null,
        dto.waterAvailabilityStatus || null,
        dto.cropCondition || null,
        dto.cropYieldQuantity !== undefined ? dto.cropYieldQuantity : null,
        dto.cropYieldUnit || null,
        dto.cropSalePricePerUnit !== undefined ? dto.cropSalePricePerUnit : null,
        dto.cultivationExpensesInr !== undefined ? dto.cultivationExpensesInr : null,
        dto.farmerRemarks || null,
        dto.surveyorName || null,
        dto.measurementSource || null,
        newVersion,
        dto.correctionReason,
        user.id,
        id,
      ]
    );

    const updatedRow = updateRes.rows[0];

    // Log correction in audit table
    await db.query(
      `INSERT INTO field_survey_audit_logs (
        survey_id, action, changed_by, reason, previous_data, new_data
      ) VALUES ($1, 'correction', $2, $3, $4, $5)`,
      [id, user.id, dto.correctionReason, JSON.stringify(prev), JSON.stringify(updatedRow)]
    );

    // If season linked, recalculate water analytics
    if (updatedRow.season_id) {
      try {
        await analyticsService.recalculateSeasonWaterMetrics(updatedRow.season_id);
      } catch (err: any) {
        console.warn(`[SurveyService] Note: recalculateSeasonWaterMetrics failed on correction:`, err.message);
      }
    }

    return this.getSurveyById(id, scopedVillages) as Promise<FieldSurvey>;
  }

  /**
   * Retrieves complete audit history for a survey.
   */
  async getSurveyAuditLogs(surveyId: string): Promise<SurveyAuditLog[]> {
    const res = await db.query(
      `SELECT al.*, u.name as changed_by_name
       FROM field_survey_audit_logs al
       LEFT JOIN users u ON u.id = al.changed_by
       WHERE al.survey_id = $1
       ORDER BY al.created_at ASC`,
      [surveyId]
    );

    return res.rows.map((r) => ({
      id: r.id,
      surveyId: r.survey_id,
      action: r.action,
      changedBy: r.changed_by,
      changedByName: r.changed_by_name || null,
      reason: r.reason || null,
      previousData: r.previous_data,
      newData: r.new_data,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
    }));
  }

  /**
   * Compares two surveys side-by-side (e.g. initial baseline vs mid-season vs harvest).
   */
  async compareSurveys(
    id1: string,
    id2: string,
    scopedVillages: string[] | null
  ): Promise<SurveyComparison> {
    const s1 = await this.getSurveyById(id1, scopedVillages);
    const s2 = await this.getSurveyById(id2, scopedVillages);

    if (!s1 || !s2) {
      throw new Error('One or both surveys could not be found for comparison');
    }

    // Yield normalized in kg (1 quintal = 100 kg, 1 tonne = 1000 kg)
    const normalizeYieldKg = (qty?: number | null, unit?: string | null): number | null => {
      if (qty === null || qty === undefined) return null;
      if (unit === 'quintal') return qty * 100;
      if (unit === 'tonne') return qty * 1000;
      return qty;
    };

    const y1 = normalizeYieldKg(s1.cropYieldQuantity, s1.cropYieldUnit);
    const y2 = normalizeYieldKg(s2.cropYieldQuantity, s2.cropYieldUnit);

    return {
      survey1: s1,
      survey2: s2,
      deltas: {
        appliedWaterVolumeM3:
          s1.appliedWaterVolumeM3 != null && s2.appliedWaterVolumeM3 != null
            ? Math.round((s2.appliedWaterVolumeM3 - s1.appliedWaterVolumeM3) * 100) / 100
            : null,
        appliedWaterLitres:
          s1.appliedWaterLitres != null && s2.appliedWaterLitres != null
            ? Math.round((s2.appliedWaterLitres - s1.appliedWaterLitres) * 100) / 100
            : null,
        irrigationDurationHours:
          s1.irrigationDurationHours != null && s2.irrigationDurationHours != null
            ? Math.round((s2.irrigationDurationHours - s1.irrigationDurationHours) * 100) / 100
            : null,
        pumpDischargeLps:
          s1.pumpDischargeLps != null && s2.pumpDischargeLps != null
            ? Math.round((s2.pumpDischargeLps - s1.pumpDischargeLps) * 100) / 100
            : null,
        irrigationDepthMm:
          s1.irrigationDepthMm != null && s2.irrigationDepthMm != null
            ? Math.round((s2.irrigationDepthMm - s1.irrigationDepthMm) * 100) / 100
            : null,
        rainfallMm:
          s1.rainfallMm != null && s2.rainfallMm != null
            ? Math.round((s2.rainfallMm - s1.rainfallMm) * 100) / 100
            : null,
        yieldQuantityNormalizedKg:
          y1 != null && y2 != null ? Math.round((y2 - y1) * 100) / 100 : null,
        cultivationExpensesInr:
          s1.cultivationExpensesInr != null && s2.cultivationExpensesInr != null
            ? Math.round((s2.cultivationExpensesInr - s1.cultivationExpensesInr) * 100) / 100
            : null,
        cropConditionChanged: s1.cropCondition !== s2.cropCondition,
        waterStatusChanged: s1.waterAvailabilityStatus !== s2.waterAvailabilityStatus,
      },
    };
  }

  private mapSurveyRow(r: any): FieldSurvey {
    return {
      id: r.id,
      farmerId: r.farmer_id,
      farmerName: r.farmer_name || null,
      farmerCode: r.farmer_code || null,
      villageId: r.village_id,
      villageName: r.village_name || null,
      mandal: r.mandal || null,
      district: r.district || null,
      plotId: r.plot_id || null,
      plotName: r.plot_name || null,
      seasonId: r.season_id || null,
      seasonName: r.season_type && r.season_year ? `${r.season_type.toUpperCase()} ${r.season_year}` : null,
      seasonCode: r.season_code || null,
      surveyDate: r.survey_date instanceof Date ? r.survey_date.toISOString().split('T')[0] : String(r.survey_date).split('T')[0],
      surveyPeriod: r.survey_period,
      cropId: r.crop_id || null,
      cropName: r.crop_name || null,
      cropStageId: r.crop_stage_id || null,
      cropStageName: r.crop_stage_name || null,
      areaAcres: r.area_acres !== null ? Number(r.area_acres) : null,
      soilType: r.soil_type || null,
      waterSourceTypeId: r.water_source_type_id || null,
      waterSourceName: r.water_source_name || null,
      irrigationMethodTypeId: r.irrigation_method_type_id || null,
      irrigationMethodName: r.irrigation_method_name || null,
      irrigationFrequencyDays: r.irrigation_frequency_days !== null ? Number(r.irrigation_frequency_days) : null,
      irrigationDurationHours: r.irrigation_duration_hours !== null ? Number(r.irrigation_duration_hours) : null,
      pumpDischargeLps: r.pump_discharge_lps !== null ? Number(r.pump_discharge_lps) : null,
      pumpHoursPerEvent: r.pump_hours_per_event !== null ? Number(r.pump_hours_per_event) : null,
      irrigationDepthMm: r.irrigation_depth_mm !== null ? Number(r.irrigation_depth_mm) : null,
      appliedWaterVolumeM3: r.applied_water_volume_m3 !== null ? Number(r.applied_water_volume_m3) : null,
      appliedWaterLitres: r.applied_water_litres !== null ? Number(r.applied_water_litres) : null,
      rainfallMm: r.rainfall_mm !== null ? Number(r.rainfall_mm) : null,
      rainfallSource: r.rainfall_source as RainfallSource,
      waterAvailabilityStatus: r.water_availability_status as WaterAvailabilityStatus,
      cropCondition: r.crop_condition as CropCondition,
      cropYieldQuantity: r.crop_yield_quantity !== null ? Number(r.crop_yield_quantity) : null,
      cropYieldUnit: r.crop_yield_unit || null,
      cropSalePricePerUnit: r.crop_sale_price_per_unit !== null ? Number(r.crop_sale_price_per_unit) : null,
      cultivationExpensesInr: r.cultivation_expenses_inr !== null ? Number(r.cultivation_expenses_inr) : null,
      farmerRemarks: r.farmer_remarks || null,
      surveyorName: r.surveyor_name || null,
      measurementSource: r.measurement_source as MeasurementSource,
      dataOrigin: r.data_origin as DataOrigin,
      version: Number(r.version) || 1,
      isCorrection: Boolean(r.is_correction),
      correctedSurveyId: r.corrected_survey_id || null,
      correctionReason: r.correction_reason || null,
      createdBy: r.created_by || null,
      createdByName: r.created_by_name || null,
      updatedBy: r.updated_by || null,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      updatedAt: r.updated_at instanceof Date ? r.updated_at.toISOString() : String(r.updated_at),
    };
  }
}

export const surveyService = new SurveyService();
