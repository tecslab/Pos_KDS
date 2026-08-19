ALTER TABLE public.inventory_movements
  ADD CONSTRAINT inventory_movements_rollback_reference_required
  CHECK (type <> 'ROLLBACK' OR reversed_movement_id IS NOT NULL);
