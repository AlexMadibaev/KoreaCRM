import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AccessGuard, RequirePermission } from '../auth/guards';
import type { AccessContext } from '../auth/policy';
import { EmployeesService } from './employees.service';
import { employeeActivitySchema, employeeCreateSchema, employeeListSchema, employeePatchSchema, parseEmployeeInput, roleCreateSchema, rolePatchSchema } from './employees.schemas';

type AuthorizedRequest = Request & { access: AccessContext };

@ApiTags('employees') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('employees')
export class EmployeesController {
  constructor(private readonly service: EmployeesService) {}
  @Get() @RequirePermission('employees.view') list(@Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.list(req.access, parseEmployeeInput(employeeListSchema, query)); }
  @Get(':id/activity') @RequirePermission('employees.view') activity(@Param('id', ParseUUIDPipe) id: string, @Query() query: unknown, @Req() req: AuthorizedRequest) { return this.service.activity(id, req.access, parseEmployeeInput(employeeActivitySchema, query)); }
  @Post() @RequirePermission('employees.create') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.create(parseEmployeeInput(employeeCreateSchema, body), req.access); }
  @Patch(':id') @RequirePermission('employees.edit') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.update(id, parseEmployeeInput(employeePatchSchema, body), req.access); }
}

@ApiTags('roles') @ApiBearerAuth() @UseGuards(AccessGuard) @Controller('roles')
export class RolesController {
  constructor(private readonly service: EmployeesService) {}
  @Get() @RequirePermission('employees.view') list() { return this.service.roles(); }
  @Get('permissions') @RequirePermission('employees.view') permissions() { return this.service.permissions(); }
  @Post() @RequirePermission('settings.edit') create(@Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.createRole(parseEmployeeInput(roleCreateSchema, body), req.access); }
  @Patch(':id') @RequirePermission('settings.edit') update(@Param('id', ParseUUIDPipe) id: string, @Body() body: unknown, @Req() req: AuthorizedRequest) { return this.service.updateRole(id, parseEmployeeInput(rolePatchSchema, body), req.access); }
}
