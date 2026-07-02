import { useState } from 'react'

import {
  Combobox,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxInput,
  ComboboxItem,
  ComboboxList,
} from '@/components/ui/combobox'
import { formatCentsForMoneyInput, type MaterialOption } from '../detail-model'
import { useServiceOrderMaterialsData } from '../queries'

/**
 * Typeahead over the active material catalog, shown alongside the free-text
 * description input on part rows. Selecting a material binds the row to the
 * catalog reference; clearing it (or typing) drops back to free-text. On
 * desktop/offline the catalog query returns an empty list, so the picker just
 * shows "nenhum material encontrado" and the free-text flow keeps working.
 */
export function QuoteItemMaterialPicker({
  materialId,
  disabled = false,
  onSelectMaterial,
  onClearMaterial,
}: {
  materialId: number | null
  disabled?: boolean
  onSelectMaterial: (material: MaterialOption) => void
  onClearMaterial: () => void
}) {
  const [search, setSearch] = useState('')
  const [selectedMaterial, setSelectedMaterial] =
    useState<MaterialOption | null>(null)
  const { data, isLoading } = useServiceOrderMaterialsData(search)
  const materials = data?.data ?? []

  // Derive the displayed selection from the controlled `materialId` so an
  // external reset (e.g. the row type changing away from "part") clears the
  // input without an effect.
  const activeMaterial = materialId === null ? null : selectedMaterial
  const displayValue = activeMaterial ? activeMaterial.name : search
  const hasValue = materialId !== null || search.length > 0

  return (
    <Combobox
      value={materialId === null ? '' : String(materialId)}
      onValueChange={(value) => {
        if (!value) {
          setSelectedMaterial(null)
          setSearch('')
          onClearMaterial()
          return
        }
        const material = materials.find((item) => String(item.id) === value)
        if (!material) return
        setSelectedMaterial(material)
        setSearch('')
        onSelectMaterial(material)
      }}
      disabled={disabled}
    >
      <ComboboxInput
        className="w-full"
        placeholder="Buscar material..."
        value={displayValue}
        onChange={(event) => {
          if (materialId !== null) {
            setSelectedMaterial(null)
            onClearMaterial()
          }
          setSearch(event.target.value)
        }}
        showClear={hasValue}
      />
      <ComboboxContent>
        <ComboboxList>
          <ComboboxEmpty>
            {isLoading
              ? 'Carregando materiais...'
              : 'Nenhum material encontrado'}
          </ComboboxEmpty>
          {materials.map((material) => {
            const priceLabel = formatCentsForMoneyInput(material.unitPriceCents)
            const stockLabel =
              material.controlsStock && material.stockQuantity !== null
                ? `Estoque: ${material.stockQuantity}`
                : null
            const subtitle = [
              material.sku,
              priceLabel ? `R$ ${priceLabel}` : null,
              stockLabel,
            ]
              .filter(Boolean)
              .join(' | ')
            return (
              <ComboboxItem key={material.id} value={String(material.id)}>
                <div className="flex flex-col">
                  <span>{material.name}</span>
                  {subtitle ? (
                    <span className="text-xs text-muted-foreground">
                      {subtitle}
                    </span>
                  ) : null}
                </div>
              </ComboboxItem>
            )
          })}
        </ComboboxList>
      </ComboboxContent>
    </Combobox>
  )
}
