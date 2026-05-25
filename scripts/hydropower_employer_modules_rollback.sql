-- Rollback for Hydropower Employer-Side Monitoring Modules.
-- This removes only the extension tables created by hydropower_employer_modules_migration.sql.
-- Existing legacy HPMS data/tables are not touched.

drop table if exists rfi_logs;
drop table if exists drawing_approval_logs;
drop table if exists safety_logs;
drop table if exists qaqc_logs;
drop table if exists report_generation_logs;
drop table if exists ipc_progress_mapping;
drop table if exists dashboard_alerts;
drop table if exists progress_calculation_summary;
drop table if exists revision_history;
drop table if exists approval_workflow_logs;
drop table if exists delay_logs;
drop table if exists photo_evidence;
drop table if exists material_logs;
drop table if exists equipment_logs;
drop table if exists manpower_logs;
drop table if exists hmem_progress_records;
drop table if exists penstock_progress_records;
drop table if exists headworks_progress_records;
drop table if exists powerhouse_progress_records;
drop table if exists tunnel_progress_records;
drop table if exists daily_progress_records;
drop table if exists daily_site_report;
drop table if exists schedule_mapping;
drop table if exists boq_mapping;
drop table if exists wbs_master;
