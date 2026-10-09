import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { validate } from '../middleware/validate.js';
import * as authService from '../services/authService.js';
import * as otp from '../services/otp.js';
import { logger, maskPhone } from '../utils/logger.js';
import { otpRequest, otpVerify, refreshBody } from './schemas.js';

export const authRouter = Router();

// Layered limits: per IP (cheap abuse), per phone (SMS pumping / harassment of a victim number).
const otpReqPerIp = rateLimit({ prefix: 'otp_req_ip', points: 10, duration: 3600 });
const otpReqPerPhone = rateLimit({ prefix: 'otp_req_phone', points: 5, duration: 3600 }, (req) => req.valid.body.phone);
const otpVerifyPerIp = rateLimit({ prefix: 'otp_ver_ip', points: 30, duration: 900, blockDuration: 900 });
const otpVerifyPerPhone = rateLimit({ prefix: 'otp_ver_phone', points: 10, duration: 900, blockDuration: 900 }, (req) => req.valid.body.phone);
const refreshLimit = rateLimit({ prefix: 'refresh', points: 60, duration: 600 });

authRouter.post('/otp/request', otpReqPerIp, validate(otpRequest), otpReqPerPhone, async (req, res, next) => {
  try {
    const { phone, email } = req.valid.body;
    await otp.requestOtp({ phone, email });
    logger.info({ phone: maskPhone(phone) }, 'otp requested');
    // Same response whether or not the number is registered: no account enumeration.
    res.status(202).json({ ok: true, expiresIn: 300 });
  } catch (err) {
    next(err);
  }
});

authRouter.post('/otp/verify', otpVerifyPerIp, validate(otpVerify), otpVerifyPerPhone, async (req, res, next) => {
  try {
    const { phone, code, device } = req.valid.body;
    await otp.verifyOtp({ phone, code });
    res.json(await authService.loginWithPhone({ phone, device, ip: req.ip }));
  } catch (err) {
    next(err);
  }
});

authRouter.post('/refresh', refreshLimit, validate(refreshBody), async (req, res, next) => {
  try {
    res.json(await authService.refresh({ refreshToken: req.valid.body.refreshToken, ip: req.ip }));
  } catch (err) {
    next(err);
  }
});

authRouter.post('/logout', requireAuth, validate(refreshBody), async (req, res, next) => {
  try {
    await authService.logout({ refreshToken: req.valid.body.refreshToken });
    res.status(204).end();
  } catch (err) {
    next(err);
  }
});
