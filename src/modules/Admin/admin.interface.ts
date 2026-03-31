import { Role } from "../../types/role.js";

export interface IAdmin {
    name: string;
    email: string;
    password: string;
    role: Role;
}
