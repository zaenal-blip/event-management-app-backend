import { hash, verify } from "argon2";

export const hashPassword = async (password: string) => {
  return await hash(password);
};

export const comparePassword = async (
  plainPassword: string,
  hashedPassword: string,
) => {
  return await verify(hashedPassword, plainPassword);
};
