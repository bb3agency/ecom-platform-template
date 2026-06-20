-- Migration: Add OPS_USER_LOGGED_IN and OPS_USER_LOGGED_OUT to OpsActionType enum
-- These values support the new browser-based ops login flow (OTP → httpOnly cookie session).

ALTER TYPE "OpsActionType" ADD VALUE IF NOT EXISTS 'OPS_USER_LOGGED_IN';
ALTER TYPE "OpsActionType" ADD VALUE IF NOT EXISTS 'OPS_USER_LOGGED_OUT';
