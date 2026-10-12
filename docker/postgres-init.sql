-- Runs once on first start of the Postgres volume (user "rentnerd" and database "rentnerd"
-- come from the POSTGRES_* variables). Adds the database used by the tests.
CREATE DATABASE rentnerd_test OWNER rentnerd;
