


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "pg_graphql" WITH SCHEMA "graphql";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";





SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."availability" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "week_start" "date" NOT NULL,
    "sun" boolean DEFAULT false,
    "mon" boolean DEFAULT false,
    "tue" boolean DEFAULT false,
    "wed" boolean DEFAULT false,
    "thu" boolean DEFAULT false,
    "fri" boolean DEFAULT false,
    "sat" boolean DEFAULT false,
    "sun_done_by" time without time zone,
    "mon_done_by" time without time zone,
    "tue_done_by" time without time zone,
    "wed_done_by" time without time zone,
    "thu_done_by" time without time zone,
    "fri_done_by" time without time zone,
    "sat_done_by" time without time zone,
    "submitted_at" timestamp with time zone DEFAULT "now"(),
    "updated_after_saturday" boolean DEFAULT false,
    "update_reason" "text"
);


ALTER TABLE "public"."availability" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."driver_locations" (
    "driver_id" "uuid" NOT NULL,
    "latitude" numeric NOT NULL,
    "longitude" numeric NOT NULL,
    "updated_at" timestamp with time zone NOT NULL
);


ALTER TABLE "public"."driver_locations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."entries" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "driver_id" "uuid" NOT NULL,
    "date" "date" NOT NULL,
    "pay" numeric(10,2) NOT NULL,
    "hours" numeric(4,1),
    "city" "text" NOT NULL,
    "crm_id" "text" NOT NULL,
    "recon_missed" boolean DEFAULT false,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "miles" numeric(7,1) DEFAULT 0,
    "actual_cost" numeric(10,2) DEFAULT 0,
    "estimated_cost" numeric(10,2) DEFAULT 0,
    "carpage_link" "text",
    "drive_time" numeric
);


ALTER TABLE "public"."entries" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."profiles" (
    "id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "role" "text" NOT NULL,
    CONSTRAINT "profiles_role_check" CHECK (("role" = ANY (ARRAY['admin'::"text", 'driver'::"text"])))
);


ALTER TABLE "public"."profiles" OWNER TO "postgres";


ALTER TABLE ONLY "public"."availability"
    ADD CONSTRAINT "availability_driver_id_week_start_key" UNIQUE ("driver_id", "week_start");



ALTER TABLE ONLY "public"."availability"
    ADD CONSTRAINT "availability_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."driver_locations"
    ADD CONSTRAINT "driver_locations_pkey" PRIMARY KEY ("driver_id");



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."availability"
    ADD CONSTRAINT "availability_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."driver_locations"
    ADD CONSTRAINT "driver_locations_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."entries"
    ADD CONSTRAINT "entries_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "public"."profiles"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."profiles"
    ADD CONSTRAINT "profiles_id_fkey" FOREIGN KEY ("id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "Admins full access entries" ON "public"."entries" USING ((( SELECT "profiles"."role"
   FROM "public"."profiles"
  WHERE ("profiles"."id" = "auth"."uid"())) = 'admin'::"text"));



CREATE POLICY "Authenticated users can read all profiles" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "Authenticated users can read driver locations" ON "public"."driver_locations" FOR SELECT TO "authenticated" USING (true);



CREATE POLICY "Drivers can insert own entries" ON "public"."entries" FOR INSERT TO "authenticated" WITH CHECK (("auth"."uid"() = "driver_id"));



CREATE POLICY "Drivers can upsert own location" ON "public"."driver_locations" TO "authenticated" USING (("auth"."uid"() = "driver_id")) WITH CHECK (("auth"."uid"() = "driver_id"));



CREATE POLICY "Drivers see own entries" ON "public"."entries" FOR SELECT USING (("auth"."uid"() = "driver_id"));



CREATE POLICY "Users can read own profile" ON "public"."profiles" FOR SELECT USING (("auth"."uid"() = "id"));



ALTER TABLE "public"."availability" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "availability_insert" ON "public"."availability" FOR INSERT WITH CHECK (("auth"."uid"() = "driver_id"));



CREATE POLICY "availability_select" ON "public"."availability" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "availability_update" ON "public"."availability" FOR UPDATE USING (("auth"."uid"() = "driver_id"));



ALTER TABLE "public"."driver_locations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."entries" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."profiles" ENABLE ROW LEVEL SECURITY;




ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";


GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";








































































































































































GRANT ALL ON TABLE "public"."availability" TO "anon";
GRANT ALL ON TABLE "public"."availability" TO "authenticated";
GRANT ALL ON TABLE "public"."availability" TO "service_role";



GRANT ALL ON TABLE "public"."driver_locations" TO "anon";
GRANT ALL ON TABLE "public"."driver_locations" TO "authenticated";
GRANT ALL ON TABLE "public"."driver_locations" TO "service_role";



GRANT ALL ON TABLE "public"."entries" TO "anon";
GRANT ALL ON TABLE "public"."entries" TO "authenticated";
GRANT ALL ON TABLE "public"."entries" TO "service_role";



GRANT ALL ON TABLE "public"."profiles" TO "anon";
GRANT ALL ON TABLE "public"."profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."profiles" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































