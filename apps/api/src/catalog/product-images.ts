import { BadRequestException, ConflictException, Controller, Delete, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { Request, Response } from 'express';
import sharp from 'sharp';
import { DatabaseService } from '../database.service';
import { AccessGuard, RequirePermission } from '../auth/guards';

const maximumBytes = 5_000_000;
const maximumImages = 20;
const imageDirectory = resolve(process.env.PRODUCT_IMAGE_DIR ?? join(process.cwd(), 'uploads', 'products'));
const keyPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(jpg|png|webp)$/;
type Upload = { buffer: Buffer; size: number };
type AuthorizedRequest = Request & { access: { userId: string } };

export function imageFormat(buffer: Buffer): { extension: string; mime: string } | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return { extension: 'png', mime: 'image/png' };
  if (buffer.length >= 3 && buffer.subarray(0, 3).equals(Buffer.from([255, 216, 255]))) return { extension: 'jpg', mime: 'image/jpeg' };
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return { extension: 'webp', mime: 'image/webp' };
  return null;
}

export async function normalizeProductImage(buffer: Buffer): Promise<Buffer> {
  try {
    return await sharp(buffer, { limitInputPixels: 40_000_000 })
      .autoOrient()
      .resize(360, 360, { fit: 'cover', position: 'centre', kernel: 'lanczos3' })
      .webp({ quality: 92, effort: 6, smartSubsample: true })
      .toBuffer();
  } catch {
    throw new BadRequestException('Не удалось обработать изображение. Выберите исправный файл JPEG, PNG или WebP.');
  }
}

@Injectable()
export class ProductImagesService {
  constructor(private readonly db: DatabaseService) {}

  async add(productId: string, file: Upload | undefined, userId: string) {
    if (!file?.buffer?.length || file.size > maximumBytes || file.buffer.length > maximumBytes) throw new BadRequestException('Выберите изображение до 5 МБ');
    const format = imageFormat(file.buffer);
    if (!format) throw new BadRequestException('Поддерживаются только JPEG, PNG и WebP');
    const product = await this.db.product.findFirst({ where: { id: productId, deletedAt: null }, select: { id: true } });
    if (!product) throw new NotFoundException('Товар не найден');
    const existing = await this.db.productImage.aggregate({ where: { productId }, _count: { _all: true }, _max: { sortOrder: true } });
    if (existing._count._all >= maximumImages) throw new ConflictException('У товара может быть не более 20 изображений');
    const optimized = await normalizeProductImage(file.buffer);
    const storageKey = `${randomUUID()}.webp`;
    const filePath = join(imageDirectory, storageKey);
    await mkdir(imageDirectory, { recursive: true });
    await writeFile(filePath, optimized, { flag: 'wx' });
    try {
      return await this.db.$transaction(async tx => {
        const image = await tx.productImage.create({ data: { productId, storageKey, sortOrder: (existing._max.sortOrder ?? -1) + 1 } });
        await tx.auditLog.create({ data: { userId, action: 'PRODUCT_IMAGE_ADDED', entityType: 'ProductImage', entityId: image.id, newValue: { productId, storageKey } } });
        return image;
      });
    } catch (error) { await unlink(filePath).catch(() => undefined); throw error; }
  }

  async remove(productId: string, imageId: string, userId: string) {
    const image = await this.db.productImage.findFirst({ where: { id: imageId, productId, product: { deletedAt: null } } });
    if (!image) throw new NotFoundException('Изображение не найдено');
    await this.db.$transaction(async tx => {
      await tx.productImage.delete({ where: { id: imageId } });
      await tx.auditLog.create({ data: { userId, action: 'PRODUCT_IMAGE_REMOVED', entityType: 'ProductImage', entityId: imageId, oldValue: { productId, storageKey: image.storageKey } } });
    });
    await unlink(join(imageDirectory, image.storageKey)).catch(() => undefined);
    return { success: true };
  }

  async read(key: string) {
    if (!keyPattern.test(key)) throw new NotFoundException('Изображение не найдено');
    const image = await this.db.productImage.findFirst({ where: { storageKey: key, product: { deletedAt: null } }, select: { id: true } });
    if (!image) throw new NotFoundException('Изображение не найдено');
    try { return await readFile(join(imageDirectory, key)); }
    catch { throw new NotFoundException('Файл изображения не найден'); }
  }
}

@Controller('products/:id/images')
@UseGuards(AccessGuard)
export class ProductImagesController {
  constructor(private readonly images: ProductImagesService) {}

  @Post()
  @RequirePermission('products.edit')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: maximumBytes, files: 1 } }))
  add(@Param('id', ParseUUIDPipe) id: string, @UploadedFile() file: Upload | undefined, @Req() request: AuthorizedRequest) {
    return this.images.add(id, file, request.access.userId);
  }

  @Delete(':imageId')
  @RequirePermission('products.edit')
  remove(@Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string, @Req() request: AuthorizedRequest) {
    return this.images.remove(id, imageId, request.access.userId);
  }
}

@Controller('product-images')
export class ProductImageFilesController {
  constructor(private readonly images: ProductImagesService) {}

  @Get(':key')
  async get(@Param('key') key: string, @Res() response: Response) {
    const bytes = await this.images.read(key);
    const mime = key.endsWith('.png') ? 'image/png' : key.endsWith('.webp') ? 'image/webp' : 'image/jpeg';
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.type(mime).send(bytes);
  }
}
