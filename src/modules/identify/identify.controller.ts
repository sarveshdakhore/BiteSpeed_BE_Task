import type { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

import { HttpError } from '../../lib/httpError';
import type { IdentifyInput } from './identify.types';
import type { ContactService } from './identify.service';

const identifyPayloadSchema = z
  .object({
    email: z.preprocess(
      (value) => (value === null ? undefined : value),
      z.string().trim().min(1, 'email cannot be empty').optional(),
    ),
    phoneNumber: z.preprocess(
      (value) => {
        if (value === null || typeof value === 'undefined') {
          return undefined;
        }

        if (typeof value === 'number') {
          return String(value);
        }

        return value;
      },
      z.string().trim().min(1, 'phoneNumber cannot be empty').optional(),
    ),
  })
  .strict()
  .superRefine((data, ctx) => {
    if (!data.email && !data.phoneNumber) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'At least one of email or phoneNumber is required',
        path: ['email'],
      });
    }
  });

const secondaryContactsParamSchema = z.object({
  primaryContactId: z.coerce.number().int().positive(),
});

export function createIdentifyController(contactService: ContactService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedPayload = identifyPayloadSchema.safeParse(req.body);
      if (!parsedPayload.success) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'Invalid request payload',
          parsedPayload.error.issues,
        );
      }

      const payload: IdentifyInput = parsedPayload.data;
      const shouldTrace = req.query.trace === 'true';
      let result;

      if (shouldTrace) {
        const tracedResponse = await contactService.identifyWithTrace(payload, { requestId: req.requestId });
        const encodedTrace = Buffer.from(JSON.stringify(tracedResponse.trace), 'utf-8').toString('base64url');
        res.setHeader('x-identify-trace', encodedTrace);
        result = tracedResponse.result;
      } else {
        result = await contactService.identify(payload, { requestId: req.requestId });
      }

      res.status(200).json({
        contact: result,
      });
    } catch (error) {
      next(error);
    }
  };
}

export function createSecondaryContactsController(contactService: ContactService) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const parsedParams = secondaryContactsParamSchema.safeParse(req.params);
      if (!parsedParams.success) {
        throw new HttpError(
          400,
          'VALIDATION_ERROR',
          'Invalid path parameters',
          parsedParams.error.issues,
        );
      }

      const response = await contactService.getSecondaryContacts(parsedParams.data.primaryContactId);

      if (!response.found) {
        throw new HttpError(404, 'CONTACT_NOT_FOUND', 'Contact not found');
      }

      res.status(200).json({
        primaryContactId: response.primaryContactId,
        secondaryContacts: response.secondaryContacts,
      });
    } catch (error) {
      next(error);
    }
  };
}
