import { Request, Response } from "express";
import { UserService } from "./user.service.js";

export class UserController {
  constructor(private userService: UserService) {}

  getUsers = async (req: Request, res: Response) => {
    const query = {
      page: parseInt(req.query.page as string) || 1,
      take: parseInt(req.query.take as string) || 3,
      sortOrder: (req.query.sortOrder as string) || "desc",
      sortBy: (req.query.sortBy as string) || "createdAt",
      search: (req.query.search as string) || "",
    };
    const result = await this.userService.getUsers(query);
    res.status(200).send(result);
  };

  getUser = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = await this.userService.getUser(id);
    res.status(200).send(result);
  };

  createUser = async (req: Request, res: Response) => {
    const body = req.body;
    const result = await this.userService.createUser(body);
    res.status(200).send(result);
  };

  updateUser = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body;
    const result = await this.userService.updateUser(id, body);
    res.status(200).send(result);
  };

  updatePassword = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body;
    const result = await this.userService.updatePassword(id, body);
    res.status(200).send(result);
  };

  updateProfile = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body;
    const result = await this.userService.updateProfile(id, body);
    res.status(200).send(result);
  };

  updateOrganizerProfile = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const body = req.body;
    const result = await this.userService.updateOrganizerProfile(id, body);
    res.status(200).send(result);
  };

  getOrganizerProfile = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = await this.userService.getOrganizerProfile(id);
    res.status(200).send(result);
  };

  deleteUser = async (req: Request, res: Response) => {
    const id = Number(req.params.id);
    const result = await this.userService.deleteUser(id);
    res.status(200).send(result);
  };
}
