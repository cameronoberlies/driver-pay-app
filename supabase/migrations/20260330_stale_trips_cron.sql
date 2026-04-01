-- Schedule daily check for stale completed trips at 2 PM ET (6 PM UTC)
-- Calls the notify-stale-trips edge function

select cron.schedule(
  'check-stale-trips',
  '0 18 * * *',
  $$
  select net.http_post(
    url := 'https://yincjogkjvotupzgetqg.supabase.co/functions/v1/notify-stale-trips',
    body := '{}'::jsonb,
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InlpbmNqb2dranZvdHVwemdldHFnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTc2MTAsImV4cCI6MjA4ODQ5MzYxMH0._gxry5gqeBUFRz8la2IeHW8if1M1IdAHACMKUWy1las'
    )
  );
  $$
);
