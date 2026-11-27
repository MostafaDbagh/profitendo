import {programOf} from '../loyalty/service.js';
import type { AuthContext, AuthService } from '../auth/service.js';
import { passwordMatches } from '../auth/crypto.js';
import { ApiError } from '../errors.js';
import { requireOwnerPin, requireBusiness } from './access.js';

export async function resetOperationalData(auth: AuthService, ctx: AuthContext, businessId: string, password: string) {
  return auth.transaction(async tx => {
    const access = await requireBusiness(auth, tx, ctx, businessId, 'business.edit');
    const { membership, user } = access;
    requireOwnerPin(access);
    if (membership.role !== 'OWNER') throw new ApiError(403, 'FORBIDDEN', 'Only a business owner may clear operational data');
    if (!await passwordMatches(user.passwordHash, password)) {
      throw new ApiError(403, 'RESET_PASSWORD_INCORRECT', 'The password is incorrect');
    }

    await tx.business.update({ where: { id: businessId }, data: { revision: { increment: 1 } } });
    // This setting is transaction-local and the triggers compare it to the row's tenant.
    await tx.$queryRaw`SELECT set_config('profitlens.reset_business', ${businessId}, true)`;
    const where = { businessId };
    await tx.reportDelivery.deleteMany({ where });
    await tx.cashClose.deleteMany({ where });
    await tx.moneyEntry.deleteMany({ where });
    await tx.adjustmentLine.deleteMany({ where });
    await tx.adjustment.deleteMany({ where });
    await tx.loyaltyReward.deleteMany({where});
    await tx.loyaltyVisit.deleteMany({where});
    await tx.salePayment.deleteMany({ where });
    await tx.saleLine.deleteMany({ where });
    await tx.sale.deleteMany({ where });
    await tx.customer.deleteMany({where});
    const program=programOf(access.business.loyaltyProgram);
    if(program.stages.some(stage=>stage.productId))await tx.business.update({where:{id:businessId},data:{loyaltyProgram:{...program,enabled:false}}});
    await tx.transferEventLine.deleteMany({ where });
    await tx.transferEvent.deleteMany({ where });
    await tx.transferLine.deleteMany({ where });
    await tx.stockTransfer.deleteMany({ where });
    await tx.purchaseLine.deleteMany({ where });
    await tx.purchaseDocument.deleteMany({ where: { ...where, orderId: { not: null } } });
    await tx.purchaseDocument.deleteMany({ where });
    await tx.stockMovement.deleteMany({ where });
    await tx.stockBalance.deleteMany({ where });
    await tx.fifoLayer.deleteMany({ where });
    await tx.migrationPreview.deleteMany({ where });
    await tx.productImport.deleteMany({ where });
    await tx.productBarcode.deleteMany({ where });
    await tx.productPack.deleteMany({ where });
    await tx.product.deleteMany({ where });
    await tx.catalogueReference.deleteMany({ where });
    await tx.supplier.deleteMany({ where });
    await tx.partner.deleteMany({ where });
    await tx.authAudit.create({
      data: { action: 'business.operational_data_reset', userId: user.id, businessId, targetId: businessId },
    });
  });
}
