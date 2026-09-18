-- 자동 생성 (scripts/pg-schema.mjs) — 직접 고치지 말고 스크립트를 고쳐 다시 만드세요.
-- 원본: db/sqlite/*.sql (v17 drizzle 마이그레이션, SQLite). 검증: 같은 통합 테스트를 이 스키마 위에서 다시 돌린다.

-- SQLite에만 있는 instr()를 같은 이름으로 만들어 둔다 — 앱 SQL 한 벌이 두 방언에서 그대로 돌게 하는 값싼 방법이다.
-- SQLite의 max(a,b)는 **스칼라**다. Postgres의 max는 집계 함수라 인자가 하나뿐이어서 그대로는 깨진다.
-- instr과 같은 방법으로 흡수한다: 같은 이름의 2인자 함수를 만든다(집계와 인자 수로 구분되어 충돌하지 않는다).
-- 앱 SQL을 고치지 않아야 원본과 대조할 수 있다.
CREATE OR REPLACE FUNCTION max(a bigint, b bigint) RETURNS bigint AS $fn$
  SELECT GREATEST(a, b);
$fn$ LANGUAGE sql IMMUTABLE;

CREATE OR REPLACE FUNCTION instr(haystack text, needle text) RETURNS integer AS $fn$
  SELECT strpos(haystack, needle);
$fn$ LANGUAGE sql IMMUTABLE;

CREATE TABLE IF NOT EXISTS audit_logs (
	id text PRIMARY KEY,
	actor_id text NOT NULL,
	role text NOT NULL,
	order_id text,
	action text NOT NULL,
	before_state text,
	after_state text,
	reason text NOT NULL,
	created_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_order ON audit_logs (order_id);
CREATE TABLE IF NOT EXISTS bids (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	partner_id text NOT NULL,
	labor_cost integer NOT NULL,
	material_cost integer NOT NULL,
	transport_cost integer NOT NULL,
	discount integer NOT NULL,
	vat integer NOT NULL,
	total integer NOT NULL,
	included text NOT NULL,
	excluded text NOT NULL,
	message text NOT NULL,
	available_date text NOT NULL,
	start_hour integer NOT NULL,
	end_hour integer NOT NULL,
	status text NOT NULL,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS bids_order_partner ON bids (order_id,partner_id);
CREATE TABLE IF NOT EXISTS orders (
	id text PRIMARY KEY,
	customer_id text NOT NULL,
	title text NOT NULL,
	work_items text NOT NULL,
	description text NOT NULL,
	region text NOT NULL,
	address text NOT NULL,
	phone text NOT NULL,
	desired_date text,
	budget integer,
	deadline text NOT NULL,
	answers text NOT NULL,
	review_status text NOT NULL,
	review_completed_at text,
	routing_status text DEFAULT 'UNDECIDED' NOT NULL,
	routing_decision text,
	status text DEFAULT 'SUBMITTED' NOT NULL,
	selected_bid_id text,
	created_at text NOT NULL,
	updated_at text NOT NULL,
	revision integer DEFAULT 0 NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_customer ON orders (customer_id);
CREATE INDEX IF NOT EXISTS orders_status ON orders (status);
CREATE TABLE IF NOT EXISTS partners (
	user_id text PRIMARY KEY,
	company text NOT NULL,
	representative text NOT NULL,
	work_items text NOT NULL,
	regions text NOT NULL,
	status text DEFAULT 'PENDING' NOT NULL,
	approved_by text,
	approved_at text,
	account_status text DEFAULT 'UNVERIFIED' NOT NULL
);
CREATE TABLE IF NOT EXISTS photos (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	owner_id text NOT NULL,
	object_key text NOT NULL,
	mime text NOT NULL,
	created_at text NOT NULL,
	expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS rate_limits (
	key text PRIMARY KEY,
	count integer NOT NULL,
	expires_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_slots (
	order_id text PRIMARY KEY,
	partner_id text NOT NULL,
	date text NOT NULL,
	start_hour integer NOT NULL,
	end_hour integer NOT NULL
);
CREATE INDEX IF NOT EXISTS slots_partner_date ON schedule_slots (partner_id,date);
CREATE TABLE IF NOT EXISTS users (
	id text PRIMARY KEY,
	email text NOT NULL,
	name text NOT NULL,
	role text NOT NULL,
	phone text,
	suspended integer DEFAULT 0 NOT NULL,
	created_at text NOT NULL
);
CREATE OR REPLACE FUNCTION schedule_no_overlap_fn() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM schedule_slots s WHERE s.partner_id=NEW.partner_id AND s.date=NEW.date AND s.start_hour<NEW.end_hour AND s.end_hour>NEW.start_hour) THEN RAISE EXCEPTION 'SCHEDULE_CONFLICT'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS schedule_no_overlap ON schedule_slots;
CREATE TRIGGER schedule_no_overlap BEFORE INSERT ON schedule_slots FOR EACH ROW EXECUTE FUNCTION schedule_no_overlap_fn();
CREATE OR REPLACE FUNCTION routing_immutable_fn() RETURNS trigger AS $$
BEGIN
  IF OLD.routing_status='DECIDED' AND NEW.routing_decision IS DISTINCT FROM OLD.routing_decision THEN RAISE EXCEPTION 'ROUTING_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS routing_immutable ON orders;
CREATE TRIGGER routing_immutable BEFORE UPDATE OF routing_decision ON orders FOR EACH ROW EXECUTE FUNCTION routing_immutable_fn();
CREATE OR REPLACE FUNCTION selection_requires_review_fn() RETURNS trigger AS $$
BEGIN
  IF NEW.selected_bid_id IS NOT NULL AND (NEW.routing_decision!='MARKETPLACE' OR NEW.routing_status!='DECIDED' OR (NEW.review_status='MANUAL_REVIEW' AND NEW.review_completed_at IS NULL)) THEN RAISE EXCEPTION 'REVIEW_REQUIRED'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS selection_requires_review ON orders;
CREATE TRIGGER selection_requires_review BEFORE UPDATE OF selected_bid_id ON orders FOR EACH ROW EXECUTE FUNCTION selection_requires_review_fn();
CREATE OR REPLACE FUNCTION audit_no_update_fn() RETURNS trigger AS $$
BEGIN
  IF TRUE THEN RAISE EXCEPTION 'AUDIT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_update ON audit_logs;
CREATE TRIGGER audit_no_update BEFORE UPDATE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_no_update_fn();
CREATE OR REPLACE FUNCTION audit_no_delete_fn() RETURNS trigger AS $$
BEGIN
  IF TRUE THEN RAISE EXCEPTION 'AUDIT_IMMUTABLE'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_no_delete ON audit_logs;
CREATE TRIGGER audit_no_delete BEFORE DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION audit_no_delete_fn();
CREATE OR REPLACE FUNCTION photo_limit_fn() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM photos WHERE order_id=NEW.order_id)>=6 THEN RAISE EXCEPTION 'PHOTO_LIMIT'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS photo_limit ON photos;
CREATE TRIGGER photo_limit BEFORE INSERT ON photos FOR EACH ROW EXECUTE FUNCTION photo_limit_fn();
CREATE TABLE IF NOT EXISTS completions (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	summary text NOT NULL,
	before_photos text NOT NULL,
	after_photos text NOT NULL,
	status text NOT NULL,
	response text,
	created_at text NOT NULL,
	decided_at text
);
CREATE TABLE IF NOT EXISTS contracts (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	version integer NOT NULL,
	partner_id text NOT NULL,
	snapshot text NOT NULL,
	total integer NOT NULL,
	deposit integer NOT NULL,
	commission_bps integer NOT NULL,
	terms text NOT NULL,
	date text NOT NULL,
	start_hour integer NOT NULL,
	end_hour integer NOT NULL,
	status text NOT NULL,
	created_at text NOT NULL,
	accepted_at text
);
CREATE UNIQUE INDEX IF NOT EXISTS contract_version ON contracts (order_id,version);
CREATE TABLE IF NOT EXISTS disputes (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	opened_by text NOT NULL,
	reason text NOT NULL,
	photo_ids text NOT NULL,
	previous_status text NOT NULL,
	status text NOT NULL,
	resolution text,
	resolved_by text,
	created_at text NOT NULL,
	resolved_at text
);
CREATE TABLE IF NOT EXISTS extra_works (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	partner_id text NOT NULL,
	description text NOT NULL,
	supply integer NOT NULL,
	vat integer NOT NULL,
	total integer NOT NULL,
	photo_ids text NOT NULL,
	status text NOT NULL,
	created_at text NOT NULL,
	decided_at text
);
CREATE TABLE IF NOT EXISTS messages (
	seq integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	id text NOT NULL,
	order_id text NOT NULL,
	partner_id text NOT NULL,
	sender_id text NOT NULL,
	sender_name text NOT NULL,
	kind text NOT NULL,
	body text NOT NULL,
	photo_ids text NOT NULL,
	created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS messages_id_unique ON messages (id);
CREATE INDEX IF NOT EXISTS message_thread ON messages (order_id,partner_id,seq);
CREATE TABLE IF NOT EXISTS notifications (
	id text PRIMARY KEY,
	user_id text NOT NULL,
	order_id text NOT NULL,
	message text NOT NULL,
	created_at text NOT NULL,
	read_at text
);
CREATE INDEX IF NOT EXISTS notice_user ON notifications (user_id,created_at);
CREATE TABLE IF NOT EXISTS payments (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	target_id text NOT NULL,
	kind text NOT NULL,
	amount integer NOT NULL,
	status text NOT NULL,
	provider_key text,
	refunded integer DEFAULT 0 NOT NULL,
	receipt_url text,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS payments_provider_key_unique ON payments (provider_key);
CREATE TABLE IF NOT EXISTS refunds (
	id text PRIMARY KEY,
	payment_id text NOT NULL,
	amount integer NOT NULL,
	reason text NOT NULL,
	status text NOT NULL,
	actor_id text NOT NULL,
	created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS schedule_changes (
	id text PRIMARY KEY,
	order_id text NOT NULL,
	date text NOT NULL,
	start_hour integer NOT NULL,
	end_hour integer NOT NULL,
	reason text NOT NULL,
	status text NOT NULL,
	created_at text NOT NULL,
	decided_at text
);
CREATE TABLE IF NOT EXISTS settlements (
	order_id text PRIMARY KEY,
	partner_id text NOT NULL,
	gross integer NOT NULL,
	refunded integer NOT NULL,
	fee integer NOT NULL,
	payable integer NOT NULL,
	status text NOT NULL,
	reason text NOT NULL,
	approved_by text,
	approved_at text,
	transfer_reference text,
	paid_at text,
	updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS settlements_transfer_reference_unique ON settlements (transfer_reference);
CREATE TABLE IF NOT EXISTS trade_terms (
	order_id text PRIMARY KEY,
	commission_bps integer NOT NULL,
	reason text NOT NULL,
	updated_by text NOT NULL,
	updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS one_accepted_contract ON contracts(order_id) WHERE status='ACCEPTED';
CREATE UNIQUE INDEX IF NOT EXISTS one_active_payment ON payments(order_id,kind,target_id) WHERE status NOT IN ('ABORTED','EXPIRED');
CREATE UNIQUE INDEX IF NOT EXISTS one_pending_refund ON refunds(payment_id) WHERE status='PENDING';
CREATE UNIQUE INDEX IF NOT EXISTS one_open_dispute ON disputes(order_id) WHERE status='OPEN';
CREATE OR REPLACE FUNCTION accepted_contract_immutable_fn() RETURNS trigger AS $$
BEGIN
  IF OLD.status='ACCEPTED' THEN RAISE EXCEPTION 'ACCEPTED_CONTRACT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS accepted_contract_immutable ON contracts;
CREATE TRIGGER accepted_contract_immutable BEFORE UPDATE ON contracts FOR EACH ROW EXECUTE FUNCTION accepted_contract_immutable_fn();
CREATE OR REPLACE FUNCTION contracts_no_delete_fn() RETURNS trigger AS $$
BEGIN
  IF TRUE THEN RAISE EXCEPTION 'CONTRACT_HISTORY_IMMUTABLE'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS contracts_no_delete ON contracts;
CREATE TRIGGER contracts_no_delete BEFORE DELETE ON contracts FOR EACH ROW EXECUTE FUNCTION contracts_no_delete_fn();
CREATE OR REPLACE FUNCTION messages_no_update_fn() RETURNS trigger AS $$
BEGIN
  IF TRUE THEN RAISE EXCEPTION 'MESSAGE_HISTORY_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS messages_no_update ON messages;
CREATE TRIGGER messages_no_update BEFORE UPDATE ON messages FOR EACH ROW EXECUTE FUNCTION messages_no_update_fn();
CREATE OR REPLACE FUNCTION messages_no_delete_fn() RETURNS trigger AS $$
BEGIN
  IF TRUE THEN RAISE EXCEPTION 'MESSAGE_HISTORY_IMMUTABLE'; END IF;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS messages_no_delete ON messages;
CREATE TRIGGER messages_no_delete BEFORE DELETE ON messages FOR EACH ROW EXECUTE FUNCTION messages_no_delete_fn();
CREATE OR REPLACE FUNCTION extra_content_immutable_fn() RETURNS trigger AS $$
BEGIN
  IF TRUE THEN RAISE EXCEPTION 'EXTRA_CONTENT_IMMUTABLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS extra_content_immutable ON extra_works;
CREATE TRIGGER extra_content_immutable BEFORE UPDATE OF description,supply,vat,total,partner_id,order_id,photo_ids ON extra_works FOR EACH ROW EXECUTE FUNCTION extra_content_immutable_fn();
CREATE OR REPLACE FUNCTION schedule_update_no_overlap_fn() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM schedule_slots s WHERE s.order_id!=NEW.order_id AND s.partner_id=NEW.partner_id AND s.date=NEW.date AND s.start_hour<NEW.end_hour AND s.end_hour>NEW.start_hour) THEN RAISE EXCEPTION 'SCHEDULE_CONFLICT'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS schedule_update_no_overlap ON schedule_slots;
CREATE TRIGGER schedule_update_no_overlap BEFORE UPDATE ON schedule_slots FOR EACH ROW EXECUTE FUNCTION schedule_update_no_overlap_fn();
DROP TRIGGER IF EXISTS photo_limit ON photos;
DROP FUNCTION IF EXISTS photo_limit_fn();
CREATE OR REPLACE FUNCTION photo_limit_fn() RETURNS trigger AS $$
BEGIN
  IF (SELECT COUNT(*) FROM photos WHERE order_id=NEW.order_id)>=60 THEN RAISE EXCEPTION 'PHOTO_LIMIT'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS photo_limit ON photos;
CREATE TRIGGER photo_limit BEFORE INSERT ON photos FOR EACH ROW EXECUTE FUNCTION photo_limit_fn();
ALTER TABLE refunds ADD COLUMN IF NOT EXISTS prior_refunded integer DEFAULT 0 NOT NULL;
CREATE TABLE IF NOT EXISTS request_drafts (
	user_id text PRIMARY KEY,
	id text NOT NULL,
	payload text NOT NULL,
	revision integer DEFAULT 1 NOT NULL,
	updated_at text NOT NULL,
	expires_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS request_drafts_id_unique ON request_drafts (id);
CREATE TABLE IF NOT EXISTS submission_keys (
	id text PRIMARY KEY,
	user_id text NOT NULL,
	payload_hash text NOT NULL,
	order_id text NOT NULL,
	created_at text NOT NULL
);
CREATE OR REPLACE FUNCTION draft_not_submitted_insert_fn() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM submission_keys WHERE id=NEW.id) THEN RAISE EXCEPTION 'Request already submitted'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS draft_not_submitted_insert ON request_drafts;
CREATE TRIGGER draft_not_submitted_insert BEFORE INSERT ON request_drafts FOR EACH ROW EXECUTE FUNCTION draft_not_submitted_insert_fn();
CREATE OR REPLACE FUNCTION draft_not_submitted_update_fn() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM submission_keys WHERE id=NEW.id) THEN RAISE EXCEPTION 'Request already submitted'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS draft_not_submitted_update ON request_drafts;
CREATE TRIGGER draft_not_submitted_update BEFORE UPDATE ON request_drafts FOR EACH ROW EXECUTE FUNCTION draft_not_submitted_update_fn();
CREATE TABLE IF NOT EXISTS content_posts (
	id text PRIMARY KEY,
	kind text NOT NULL,
	title text NOT NULL,
	body text NOT NULL,
	published integer DEFAULT 0 NOT NULL,
	revision integer DEFAULT 1 NOT NULL,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS operation_settings (
	id text PRIMARY KEY,
	accepting integer DEFAULT 1 NOT NULL,
	notice text NOT NULL,
	revision integer NOT NULL,
	updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS partner_profiles (
	partner_id text PRIMARY KEY,
	about text NOT NULL,
	updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio_assets (
	id text PRIMARY KEY,
	partner_id text NOT NULL,
	object_key text NOT NULL,
	mime text NOT NULL,
	created_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS portfolio_cases (
	id text PRIMARY KEY,
	partner_id text NOT NULL,
	title text NOT NULL,
	body text NOT NULL,
	region text NOT NULL,
	asset_id text,
	published integer DEFAULT 0 NOT NULL,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS reviews (
	order_id text PRIMARY KEY,
	partner_id text NOT NULL,
	customer_id text NOT NULL,
	rating integer NOT NULL,
	body text NOT NULL,
	reply text,
	hidden integer DEFAULT 0 NOT NULL,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE OR REPLACE FUNCTION intake_pause_fn() RETURNS trigger AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM operation_settings WHERE id='main' AND accepting=0) THEN RAISE EXCEPTION 'INTAKE_PAUSED'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS intake_pause ON orders;
CREATE TRIGGER intake_pause BEFORE INSERT ON orders FOR EACH ROW EXECUTE FUNCTION intake_pause_fn();
CREATE OR REPLACE FUNCTION review_owner_completed_fn() RETURNS trigger AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orders o JOIN bids b ON b.id=o.selected_bid_id WHERE o.id=NEW.order_id AND o.customer_id=NEW.customer_id AND b.partner_id=NEW.partner_id AND o.status IN ('COMPLETED','SETTLED')) OR NEW.rating NOT BETWEEN 1 AND 5 THEN RAISE EXCEPTION 'REVIEW_NOT_ELIGIBLE'; END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS review_owner_completed ON reviews;
CREATE TRIGGER review_owner_completed BEFORE INSERT ON reviews FOR EACH ROW EXECUTE FUNCTION review_owner_completed_fn();
CREATE TABLE IF NOT EXISTS site_presentation (
	id text PRIMARY KEY,
	payload text NOT NULL,
	revision integer NOT NULL,
	updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS calendar_events (
	id text PRIMARY KEY,
	user_id text NOT NULL,
	title text NOT NULL,
	kind text NOT NULL,
	date text NOT NULL,
	start text NOT NULL,
	"end" text NOT NULL,
	note text NOT NULL,
	status text NOT NULL,
	revision integer NOT NULL,
	updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS calendar_user_date ON calendar_events (user_id,date);
CREATE TABLE IF NOT EXISTS chat_reads (
	user_id text NOT NULL,
	order_id text NOT NULL,
	partner_id text NOT NULL,
	last_seq integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_read_thread_user ON chat_reads (user_id,order_id,partner_id);
ALTER TABLE extra_works ADD COLUMN IF NOT EXISTS decided_by text;
ALTER TABLE extra_works ADD COLUMN IF NOT EXISTS decision_snapshot text;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS mode text DEFAULT 'unknown' NOT NULL;
CREATE TABLE IF NOT EXISTS questions (
	id text PRIMARY KEY,
	partner_id text NOT NULL,
	customer_id text NOT NULL,
	case_id text,
	body text NOT NULL,
	answer text,
	answered_at text,
	hidden integer DEFAULT 0 NOT NULL,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE INDEX IF NOT EXISTS questions_partner_created ON questions (partner_id,created_at);
CREATE INDEX IF NOT EXISTS questions_customer_created ON questions (customer_id,created_at);
CREATE TABLE IF NOT EXISTS company_pages (
	partner_id text PRIMARY KEY,
	draft_config text NOT NULL,
	published_config text,
	draft_revision integer DEFAULT 0 NOT NULL,
	published_revision integer DEFAULT 0 NOT NULL,
	published_at text,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE TABLE IF NOT EXISTS consultations (
	id text PRIMARY KEY,
	customer_id text NOT NULL,
	partner_id text NOT NULL,
	case_id text,
	created_at text NOT NULL,
	updated_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS consultations_pair ON consultations (customer_id,partner_id);
CREATE TABLE IF NOT EXISTS consultation_messages (
	seq integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
	id text NOT NULL,
	consultation_id text NOT NULL,
	sender_id text NOT NULL,
	sender_name text NOT NULL,
	body text NOT NULL,
	created_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS consultation_messages_id ON consultation_messages (id);
CREATE INDEX IF NOT EXISTS consultation_messages_room ON consultation_messages (consultation_id,seq);
CREATE TABLE IF NOT EXISTS consultation_reads (
	consultation_id text NOT NULL,
	user_id text NOT NULL,
	last_seq integer NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS consultation_reads_pair ON consultation_reads (consultation_id,user_id);
CREATE TABLE IF NOT EXISTS partner_documents (
	id text PRIMARY KEY,
	partner_id text NOT NULL,
	kind text NOT NULL,
	object_key text NOT NULL,
	mime text NOT NULL,
	size integer NOT NULL,
	created_at text NOT NULL,
	expires_at text NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS partner_documents_one_per_kind ON partner_documents (partner_id,kind);
CREATE INDEX IF NOT EXISTS partner_documents_expiry ON partner_documents (expires_at);
ALTER TABLE partners ADD COLUMN IF NOT EXISTS partner_type text DEFAULT 'individual' NOT NULL;

-- 외래키 (표를 전부 만든 뒤에 건다)
DO $$ BEGIN
  ALTER TABLE bids ADD CONSTRAINT bids_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE bids ADD CONSTRAINT bids_fk2 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE orders ADD CONSTRAINT orders_fk1 FOREIGN KEY (customer_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE partners ADD CONSTRAINT partners_fk1 FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE photos ADD CONSTRAINT photos_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE schedule_slots ADD CONSTRAINT schedule_slots_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE completions ADD CONSTRAINT completions_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE contracts ADD CONSTRAINT contracts_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE disputes ADD CONSTRAINT disputes_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE extra_works ADD CONSTRAINT extra_works_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE messages ADD CONSTRAINT messages_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE payments ADD CONSTRAINT payments_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE refunds ADD CONSTRAINT refunds_fk1 FOREIGN KEY (payment_id) REFERENCES payments(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE schedule_changes ADD CONSTRAINT schedule_changes_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE settlements ADD CONSTRAINT settlements_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE trade_terms ADD CONSTRAINT trade_terms_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE request_drafts ADD CONSTRAINT request_drafts_fk1 FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE submission_keys ADD CONSTRAINT submission_keys_fk1 FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE submission_keys ADD CONSTRAINT submission_keys_fk2 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE partner_profiles ADD CONSTRAINT partner_profiles_fk1 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE portfolio_assets ADD CONSTRAINT portfolio_assets_fk1 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE portfolio_cases ADD CONSTRAINT portfolio_cases_fk1 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE portfolio_cases ADD CONSTRAINT portfolio_cases_fk2 FOREIGN KEY (asset_id) REFERENCES portfolio_assets(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_fk1 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_fk2 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE reviews ADD CONSTRAINT reviews_fk3 FOREIGN KEY (customer_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE calendar_events ADD CONSTRAINT calendar_events_fk1 FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE chat_reads ADD CONSTRAINT chat_reads_fk1 FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE chat_reads ADD CONSTRAINT chat_reads_fk2 FOREIGN KEY (order_id) REFERENCES orders(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE questions ADD CONSTRAINT questions_fk1 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE questions ADD CONSTRAINT questions_fk2 FOREIGN KEY (customer_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE questions ADD CONSTRAINT questions_fk3 FOREIGN KEY (case_id) REFERENCES portfolio_cases(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE company_pages ADD CONSTRAINT company_pages_fk1 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultations ADD CONSTRAINT consultations_fk1 FOREIGN KEY (customer_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultations ADD CONSTRAINT consultations_fk2 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultations ADD CONSTRAINT consultations_fk3 FOREIGN KEY (case_id) REFERENCES portfolio_cases(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultation_messages ADD CONSTRAINT consultation_messages_fk1 FOREIGN KEY (consultation_id) REFERENCES consultations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultation_messages ADD CONSTRAINT consultation_messages_fk2 FOREIGN KEY (sender_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultation_reads ADD CONSTRAINT consultation_reads_fk1 FOREIGN KEY (consultation_id) REFERENCES consultations(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE consultation_reads ADD CONSTRAINT consultation_reads_fk2 FOREIGN KEY (user_id) REFERENCES users(id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE partner_documents ADD CONSTRAINT partner_documents_fk1 FOREIGN KEY (partner_id) REFERENCES partners(user_id);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
