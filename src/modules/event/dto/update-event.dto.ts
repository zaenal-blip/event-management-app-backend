import { Type } from "class-transformer";
import {
    IsDateString,
    IsNumber,
    IsOptional,
    IsString,
    Min,
} from "class-validator";

export class UpdateEventDto {
    @IsString()
    @IsOptional()
    title?: string;

    @IsString()
    @IsOptional()
    description?: string;

    @IsString()
    @IsOptional()
    category?: string;

    @IsString()
    @IsOptional()
    location?: string;

    @IsString()
    @IsOptional()
    venue?: string;

    @IsDateString()
    @IsOptional()
    startDate?: string;

    @IsDateString()
    @IsOptional()
    endDate?: string;

    @IsString()
    @IsOptional()
    image?: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @IsOptional()
    price?: number;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    @IsOptional()
    availableSeats?: number;
}
