-- Hydropower Employer-Side Monitoring Modules
-- Backward-compatible migration: add new tables only. Do not rename or delete existing data.

create table if not exists wbs_master (
  id text primary key,
  parent_id text references wbs_master(id),
  project_id text,
  contract_package text,
  structure_name text not null,
  substructure_name text,
  activity_name text,
  boq_item_id text,
  location_ref text,
  chainage_ref text,
  level_ref text,
  created_at timestamptz default now()
);

create table if not exists boq_mapping (
  id text primary key,
  existing_structure_id text,
  existing_item_id text,
  wbs_id text references wbs_master(id),
  boq_item_no text,
  boq_description text,
  unit text,
  boq_quantity numeric,
  boq_rate numeric,
  boq_amount numeric,
  created_at timestamptz default now()
);

create table if not exists schedule_mapping (
  id text primary key,
  wbs_id text references wbs_master(id),
  baseline_start date,
  baseline_finish date,
  revised_start date,
  revised_finish date,
  activity_weightage numeric,
  created_at timestamptz default now()
);

create table if not exists daily_site_report (
  id text primary key,
  report_date date not null,
  project_name text,
  contract_package text,
  contractor text,
  prepared_by text,
  checked_by text,
  verified_by text,
  approval_status text default 'Draft',
  created_at timestamptz default now()
);

create table if not exists daily_progress_records (
  id text primary key,
  report_id text references daily_site_report(id),
  wbs_id text references wbs_master(id),
  existing_structure_id text,
  existing_item_id text,
  location_ref text,
  chainage_ref text,
  level_ref text,
  block_ref text,
  unit text,
  previous_cumulative_quantity numeric default 0,
  today_quantity numeric default 0,
  current_cumulative_quantity numeric default 0,
  balance_quantity numeric default 0,
  boq_quantity numeric default 0,
  boq_rate numeric default 0,
  planned_quantity numeric default 0,
  progress_weightage numeric default 0,
  remarks text,
  delay_reason text,
  drawing_reference text,
  approval_status text default 'Submitted',
  created_at timestamptz default now()
);

create table if not exists tunnel_progress_records (
  id text primary key,
  report_id text references daily_site_report(id),
  tunnel_name text,
  face text,
  chainage_from text,
  chainage_to text,
  daily_advance numeric default 0,
  cumulative_advance numeric default 0,
  balance_length numeric default 0,
  rock_class text,
  excavation_type text,
  support_type text,
  rock_bolt_quantity numeric default 0,
  shotcrete_quantity numeric default 0,
  steel_rib_quantity numeric default 0,
  geological_remarks text,
  delay_reason text,
  photo_evidence_ref text,
  created_at timestamptz default now()
);

create table if not exists powerhouse_progress_records (
  id text primary key,
  report_id text references daily_site_report(id),
  powerhouse_area text,
  starting_level numeric,
  design_level numeric,
  current_excavation_level numeric,
  daily_excavation_quantity numeric default 0,
  cumulative_excavation_quantity numeric default 0,
  block_bay_level text,
  protection_work text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists headworks_progress_records (
  id text primary key,
  report_id text references daily_site_report(id),
  component text,
  block_bay text,
  excavation_quantity numeric default 0,
  concrete_quantity numeric default 0,
  rebar_quantity numeric default 0,
  formwork_quantity numeric default 0,
  monsoon_risk text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists penstock_progress_records (
  id text primary key,
  report_id text references daily_site_report(id),
  component text,
  chainage_ref text,
  level_ref text,
  pipe_diameter text,
  pipe_length_delivered numeric default 0,
  pipe_length_installed numeric default 0,
  welding_status text,
  ndt_status text,
  hydro_test_status text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists hmem_progress_records (
  id text primary key,
  report_id text references daily_site_report(id),
  component text,
  manufacturing_status text,
  factory_inspection_status text,
  factory_acceptance_test_status text,
  shipment_status text,
  customs_clearance_status text,
  site_delivery_status text,
  installation_status text,
  testing_status text,
  commissioning_status text,
  issue_pending text,
  document_url text,
  photo_evidence_ref text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists manpower_logs (
  id text primary key,
  log_date date not null,
  contractor text,
  location_ref text,
  structure_name text,
  activity_name text,
  engineer_count numeric default 0,
  supervisor_count numeric default 0,
  skilled_worker_count numeric default 0,
  unskilled_worker_count numeric default 0,
  operator_count numeric default 0,
  welder_count numeric default 0,
  electrician_count numeric default 0,
  helper_count numeric default 0,
  total_manpower numeric default 0,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists equipment_logs (
  id text primary key,
  log_date date not null,
  contractor text,
  equipment_type text,
  equipment_number text,
  location_ref text,
  activity_name text,
  working_hours numeric default 0,
  idle_hours numeric default 0,
  breakdown_hours numeric default 0,
  fuel_consumed numeric default 0,
  operator_name text,
  idle_reason text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists material_logs (
  id text primary key,
  log_date date not null,
  material_name text,
  unit text,
  opening_stock numeric default 0,
  received_quantity numeric default 0,
  consumed_quantity numeric default 0,
  balance_stock numeric default 0,
  location_ref text,
  activity_name text,
  contractor text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists photo_evidence (
  id text primary key,
  work_date date,
  uploaded_at timestamptz default now(),
  structure_name text,
  activity_name text,
  boq_item_id text,
  contractor text,
  category text,
  progress_stage text,
  location_ref text,
  gps_ref text,
  evidence_url text,
  remarks text
);

create table if not exists delay_logs (
  id text primary key,
  delay_date date not null,
  structure_name text,
  activity_name text,
  contractor text,
  delay_type text,
  delay_reason text,
  responsible_party text,
  affected_days numeric default 0,
  schedule_impact text,
  action_required text,
  target_resolution_date date,
  status text default 'Open',
  remarks text,
  created_at timestamptz default now()
);

create table if not exists approval_workflow_logs (
  id text primary key,
  record_table text,
  record_id text,
  old_status text,
  new_status text,
  action_by text,
  action_at timestamptz default now(),
  remarks text
);

create table if not exists revision_history (
  id text primary key,
  record_table text,
  record_id text,
  field_name text,
  old_value text,
  new_value text,
  changed_by text,
  changed_at timestamptz default now(),
  reason text,
  approval_status text default 'Pending'
);

create table if not exists progress_calculation_summary (
  id text primary key,
  summary_scope text,
  scope_id text,
  period_start date,
  period_end date,
  planned_progress_pct numeric default 0,
  approved_actual_progress_pct numeric default 0,
  pending_progress_pct numeric default 0,
  variance_pct numeric default 0,
  forecast_completion_date date,
  calculated_at timestamptz default now()
);

create table if not exists dashboard_alerts (
  id text primary key,
  title text not null,
  alert_type text,
  priority text,
  related_structure text,
  related_contractor text,
  action_required text,
  responsible_person text,
  due_date date,
  status text default 'Open',
  created_at timestamptz default now()
);

create table if not exists ipc_progress_mapping (
  id text primary key,
  wbs_id text references wbs_master(id),
  verified_site_quantity numeric default 0,
  measured_quantity numeric default 0,
  ipc_claimed_quantity numeric default 0,
  ipc_certified_quantity numeric default 0,
  previous_ipc_quantity numeric default 0,
  cumulative_ipc_quantity numeric default 0,
  boq_quantity numeric default 0,
  balance_quantity numeric default 0,
  mismatch_status text,
  justification text,
  created_at timestamptz default now()
);

create table if not exists report_generation_logs (
  id text primary key,
  report_type text,
  period_start date,
  period_end date,
  generated_by text,
  generated_at timestamptz default now(),
  output_format text,
  output_url text
);

create table if not exists qaqc_logs (
  id text primary key,
  log_date date not null,
  structure_name text,
  activity_name text,
  boq_item_id text,
  contractor text,
  inspection_type text,
  reference_no text,
  result text,
  non_conformance text,
  corrective_action text,
  responsible_person text,
  target_close_date date,
  status text default 'Open',
  evidence_url text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists safety_logs (
  id text primary key,
  log_date date not null,
  structure_name text,
  activity_name text,
  contractor text,
  safety_type text,
  severity text,
  incident_description text,
  action_taken text,
  responsible_person text,
  target_close_date date,
  status text default 'Open',
  evidence_url text,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists drawing_approval_logs (
  id text primary key,
  drawing_no text,
  drawing_title text,
  structure_name text,
  activity_name text,
  submitted_by text,
  submitted_date date,
  due_date date,
  approval_status text default 'Pending',
  approved_by text,
  approved_date date,
  remarks text,
  created_at timestamptz default now()
);

create table if not exists rfi_logs (
  id text primary key,
  rfi_no text,
  subject text,
  structure_name text,
  activity_name text,
  raised_by text,
  raised_date date,
  due_date date,
  response_by text,
  response_date date,
  status text default 'Pending',
  impact_on_progress text,
  remarks text,
  created_at timestamptz default now()
);
