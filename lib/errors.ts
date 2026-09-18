export class ServiceError extends Error {
    constructor(public status: number, message: string) { super(message); }
}
export function fail(status: number, message: string): never { throw new ServiceError(status, message); }
