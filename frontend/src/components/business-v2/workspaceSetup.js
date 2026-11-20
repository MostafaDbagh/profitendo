import { Building2, Layers, Package, Settings, Truck } from 'lucide-react';
import { useResource } from './useBusinessApi';

function canSetUp(context, visibleTabs, tab, permissions) {
  return context.role === 'OWNER' && visibleTabs?.includes(tab) &&
    permissions.every(permission => context.permissions[permission]);
}

export function useWorkspaceSetup(context, api, visibleTabs) {
  const base = `/businesses/${context.business.id}`;
  const canConfigure = canSetUp(context, visibleTabs, 'settings', ['business.edit']);
  const canAddLocations = canSetUp(context, visibleTabs, 'locations', ['locations.manage']);
  const canAddSuppliers = canSetUp(context, visibleTabs, 'suppliers', ['suppliers.create']);
  const canAddCategories = canSetUp(context, visibleTabs, 'catalogue', ['catalogue.manage']);
  const canAddProducts = canSetUp(context, visibleTabs, 'catalogue', ['catalogue.create', 'catalogue.cost']);

  const { data: locations } = useResource(api, canAddLocations ? `${base}/locations` : null);
  const { data: suppliers } = useResource(api, canAddSuppliers ? `${base}/operations/suppliers` : null);
  const { data: references } = useResource(api, canAddCategories ? `${base}/products/references` : null);
  const { data: products } = useResource(api, canAddProducts ? `${base}/products` : null);

  return [
    { tab: 'settings', Icon: Settings, allowed: canConfigure, complete: Boolean(context.business.countryCode) && !context.business.initialSetupPending },
    { tab: 'locations', Icon: Building2, allowed: canAddLocations, complete: locations ? locations.total > 0 : null },
    { tab: 'suppliers', Icon: Truck, allowed: canAddSuppliers, complete: suppliers ? suppliers.total > 0 : null },
    { tab: 'catalogue', Icon: Layers, allowed: canAddCategories, complete: references ? references.items.some(item => item.kind === 'CATEGORY' && item.active) : null },
    { tab: 'catalogue', Icon: Package, allowed: canAddProducts, complete: products ? products.total > 0 : null },
  ].map((step, index) => ({ ...step, number: index + 1 })).filter(step => step.allowed);
}
