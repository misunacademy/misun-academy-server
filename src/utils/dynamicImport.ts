import 'better-auth';
import 'better-auth/adapters/mongodb';
import 'better-auth/node';
export const dynamicImport = (specifier: string): Promise<any> => {
    return new Function("s", "return import(s)")(specifier);
};
