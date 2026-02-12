import { Type } from "class-transformer";
import {
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsNotEmpty,
    IsNumber,
    IsOptional,
    IsString,
    Min,
    ValidateNested,
} from "class-validator";

export class CreateTicketTypeDto {
    @IsString()
    @IsNotEmpty()
    name!: string;

    @Type(() => Number)
    @IsNumber()
    @Min(0)
    price!: number;

    @Type(() => Number)
    @IsNumber()
    @Min(1)
    totalSeat!: number;

    @IsString()
    @IsNotEmpty()
    description!: string;
}

export class CreateEventDto {
    @IsString()
    @IsNotEmpty()
    title!: string;

    @IsString()
    @IsNotEmpty()
    description!: string;

    @IsString()
    @IsNotEmpty()
    category!: string;

    @IsString()
    @IsNotEmpty()
    location!: string;

    @IsString()
    @IsNotEmpty()
    venue!: string;

    @IsDateString()
    startDate!: string;

    @IsDateString()
    endDate!: string;

    @IsString()
    @IsOptional()
    image?: string;

    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CreateTicketTypeDto)
    @ArrayMinSize(1)
    ticketTypes!: CreateTicketTypeDto[];
}
