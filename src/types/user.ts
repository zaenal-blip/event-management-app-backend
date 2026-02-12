export interface CreateUserBody {
  email: string;
  name: string;
  password: string;
  avatar?: string;
  role: "CUSTOMER" | "ORGANIZER";
  referralCode?: string;
  point?: number;
}
