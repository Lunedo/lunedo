import { BadRequestException, type PipeTransform } from "@nestjs/common";
import type { z } from "zod";

export class ZodPipe<T extends z.ZodType> implements PipeTransform<unknown, z.output<T>> {
  constructor(private readonly schema: T) {}

  transform(value: unknown): z.output<T> {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException({
        statusCode: 400,
        code: "invalidInput",
        message: "The request is not valid",
        fields: result.error.issues.map((issue) => issue.path.join(".")),
      });
    }
    return result.data;
  }
}
