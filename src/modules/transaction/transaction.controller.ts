import { Request, Response } from "express";
import { TransactionService } from "./transaction.service.js";
import { AuthRequest } from "../../middleware/auth.middleware.js";

export class TransactionController {
  constructor(private transactionService: TransactionService) { }

  createTransaction = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const eventId = Number(req.params.eventId);
    const result = await this.transactionService.createTransaction(
      req.user.id,
      eventId,
      req.body,
    );
    res.status(201).send(result);
  };

  uploadPaymentProof = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const transactionId = Number(req.params.id);
    const result = await this.transactionService.uploadPaymentProof(
      transactionId,
      req.user.id,
      req.body,
    );
    res.status(200).send(result);
  };

  confirmTransaction = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const transactionId = Number(req.params.id);
    const result = await this.transactionService.confirmTransaction(
      transactionId,
      req.user.id,
    );
    res.status(200).send(result);
  };

  rejectTransaction = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const transactionId = Number(req.params.id);
    const reason = req.body?.reason as string | undefined;
    const result = await this.transactionService.rejectTransaction(
      transactionId,
      req.user.id,
      reason,
    );
    res.status(200).send(result);
  };

  cancelTransaction = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const transactionId = Number(req.params.id);
    const result = await this.transactionService.cancelTransaction(
      transactionId,
      req.user.id,
    );
    res.status(200).send(result);
  };

  getMyTransactions = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const page = Math.max(1, Number(req.query.page) || 1);
    const take = Math.min(50, Math.max(1, Number(req.query.take) || 10));

    const result = await this.transactionService.getMyTransactions(
      req.user.id,
      page,
      take,
    );
    res.status(200).send(result);
  };

  getOrganizerTransactions = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const result = await this.transactionService.getOrganizerTransactions(
      req.user.id,
    );
    res.status(200).send(result);
  };

  getTransactionById = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const transactionId = Number(req.params.id);
    const result = await this.transactionService.getTransactionById(
      transactionId,
      req.user.id,
    );
    res.status(200).send(result);
  };

  getTickets = async (req: AuthRequest, res: Response) => {
    if (!req.user) {
      return res.status(401).send({ message: "Unauthorized" });
    }

    const transactionId = Number(req.params.id);
    const result = await this.transactionService.getTicketsByTransaction(
      transactionId,
      req.user.id,
    );
    res.status(200).send(result);
  };

  checkIn = async (req: Request, res: Response) => {
    const token = req.params.token as string;
    if (!token) {
      return res.status(400).send({ message: "Token is required" });
    }

    const result = await this.transactionService.checkIn(token);
    res.status(200).send(result);
  };
}
