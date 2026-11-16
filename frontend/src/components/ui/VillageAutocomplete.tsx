import React, { useState, useRef, useEffect } from 'react';
import { Search, Plus, MapPin, X, Check, ChevronDown, Loader2 } from 'lucide-react';
import { apiRequest } from '../../api/client.js';
import { Modal } from './Modal.js';
import { Button } from './Button.js';
import { Input } from './Input.js';

export interface Village {
  id: string;
  name: string;
  mandal: string;
  district: string;
  gram_panchayat?: string;
  latitude?: number;
  longitude?: number;
}

interface VillageAutocompleteProps {
  value: string;
  onChange: (villageId: string, village?: Village) => void;
  villages: Village[];
  onVillageCreated?: (newVillage: Village) => void;
  required?: boolean;
  label?: string;
  placeholder?: string;
  className?: string;
}

export const VillageAutocomplete: React.FC<VillageAutocompleteProps> = ({
  value,
  onChange,
  villages,
  onVillageCreated,
  required = false,
  label = 'Village',
  placeholder = 'Type to search village, mandal, or district...',
  className = '',
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // New Custom Village Form State
  const [newVillageName, setNewVillageName] = useState('');
  const [newMandal, setNewMandal] = useState('');
  const [newDistrict, setNewDistrict] = useState('Guntur');
  const [newGP, setNewGP] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selectedVillage = villages.find((v) => v.id === value);

  // Sync query when value changes
  useEffect(() => {
    if (selectedVillage) {
      setQuery(`${selectedVillage.name} (${selectedVillage.mandal}, ${selectedVillage.district})`);
    } else if (!value) {
      setQuery('');
    }
  }, [value, selectedVillage]);

  // Click outside listener
  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        // Reset query text to current selection if closed without selecting
        if (selectedVillage) {
          setQuery(`${selectedVillage.name} (${selectedVillage.mandal}, ${selectedVillage.district})`);
        } else {
          setQuery('');
        }
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [selectedVillage]);

  const filteredVillages = villages.filter((v) => {
    const q = query.toLowerCase().trim();
    if (!q) return true;
    return (
      v.name.toLowerCase().includes(q) ||
      v.mandal.toLowerCase().includes(q) ||
      v.district.toLowerCase().includes(q)
    );
  });

  const handleSelect = (v: Village) => {
    onChange(v.id, v);
    setQuery(`${v.name} (${v.mandal}, ${v.district})`);
    setIsOpen(false);
  };

  const handleClear = () => {
    onChange('');
    setQuery('');
    setIsOpen(false);
    inputRef.current?.focus();
  };

  const handleOpenAddModal = () => {
    // Trim query to set default village name
    const cleanedQuery = query.split('(')[0].trim();
    setNewVillageName(cleanedQuery || '');
    setNewMandal('');
    setNewDistrict('Guntur');
    setNewGP('');
    setAddError(null);
    setIsOpen(false);
    setIsAddModalOpen(true);
  };

  const handleCreateVillage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newVillageName.trim() || !newMandal.trim() || !newDistrict.trim()) {
      setAddError('Village name, mandal, and district are required');
      return;
    }

    setIsSubmitting(true);
    setAddError(null);

    try {
      const res = await apiRequest<{ success: boolean; data: Village }>('/reference/villages', {
        method: 'POST',
        body: JSON.stringify({
          name: newVillageName.trim(),
          mandal: newMandal.trim(),
          district: newDistrict.trim(),
          gram_panchayat: newGP.trim() || `${newVillageName.trim()} GP`,
        }),
      });

      const created = res.data;
      if (onVillageCreated) {
        onVillageCreated(created);
      }
      onChange(created.id, created);
      setQuery(`${created.name} (${created.mandal}, ${created.district})`);
      setIsAddModalOpen(false);
    } catch (err: any) {
      setAddError(err.message || 'Failed to save new custom village');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className={`relative ${className}`} ref={containerRef}>
      {label && (
        <label className="block text-xs font-semibold text-gray-700 uppercase tracking-wider mb-1.5">
          {label} {required && '*'}
        </label>
      )}

      <div className="relative">
        <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-gray-400">
          <MapPin className="w-4 h-4" />
        </div>

        <input
          ref={inputRef}
          type="text"
          value={query}
          required={required && !value}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            if (!e.target.value) {
              onChange('');
            }
          }}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className="w-full pl-9 pr-14 py-2 text-sm bg-white border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-forest-600 focus:border-forest-600 transition-shadow"
        />

        <div className="absolute inset-y-0 right-0 pr-2 flex items-center gap-1">
          {value && (
            <button
              type="button"
              onClick={handleClear}
              className="p-1 text-gray-400 hover:text-gray-600 rounded-full hover:bg-gray-100"
              title="Clear selection"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsOpen(!isOpen)}
            className="p-1 text-gray-400 hover:text-gray-600 rounded-full"
          >
            <ChevronDown className={`w-4 h-4 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
          </button>
        </div>
      </div>

      {/* Autocomplete Dropdown */}
      {isOpen && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg max-h-60 overflow-y-auto">
          {filteredVillages.length > 0 ? (
            <div className="py-1 divide-y divide-gray-50">
              {filteredVillages.map((v) => {
                const isSelected = v.id === value;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => handleSelect(v)}
                    className={`w-full px-3 py-2 text-left text-sm flex items-center justify-between hover:bg-forest-50/70 transition-colors ${
                      isSelected ? 'bg-forest-50 font-semibold text-forest-900' : 'text-gray-800'
                    }`}
                  >
                    <div>
                      <div className="font-medium text-gray-900">{v.name}</div>
                      <div className="text-xs text-gray-500">
                        {v.mandal} Mandal, {v.district} District
                      </div>
                    </div>
                    {isSelected && <Check className="w-4 h-4 text-forest-600 shrink-0" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div className="p-3 text-center text-xs text-gray-500">
              No matching villages found for "{query}"
            </div>
          )}

          {/* Add Custom Village Footer */}
          <div className="p-2 border-t border-gray-100 bg-gray-50/80 sticky bottom-0">
            <button
              type="button"
              onClick={handleOpenAddModal}
              className="w-full px-3 py-1.5 text-xs font-semibold text-forest-700 hover:text-forest-900 hover:bg-forest-100 rounded-md flex items-center justify-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>+ Add Custom Village</span>
            </button>
          </div>
        </div>
      )}

      {/* Add Custom Village Modal */}
      {isAddModalOpen && (
        <Modal
          isOpen={isAddModalOpen}
          onClose={() => setIsAddModalOpen(false)}
          title="Add New Custom Village"
        >
          <form onSubmit={handleCreateVillage} className="space-y-4">
            <p className="text-xs text-gray-600">
              Register a village not currently in the state database. It will be immediately available for selection.
            </p>

            {addError && (
              <div className="p-2.5 bg-red-50 border border-red-200 text-red-700 text-xs rounded-lg">
                {addError}
              </div>
            )}

            <Input
              label="Village Name *"
              value={newVillageName}
              onChange={(e) => setNewVillageName(e.target.value)}
              placeholder="e.g. Kondrupadu"
              required
            />

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Input
                label="Mandal *"
                value={newMandal}
                onChange={(e) => setNewMandal(e.target.value)}
                placeholder="e.g. Pedakakani"
                required
              />

              <Input
                label="District *"
                value={newDistrict}
                onChange={(e) => setNewDistrict(e.target.value)}
                placeholder="e.g. Guntur"
                required
              />
            </div>

            <Input
              label="Gram Panchayat (Optional)"
              value={newGP}
              onChange={(e) => setNewGP(e.target.value)}
              placeholder="e.g. Kondrupadu GP"
            />

            <div className="flex justify-end gap-2 pt-2 border-t border-gray-100">
              <Button variant="secondary" onClick={() => setIsAddModalOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={isSubmitting} className="flex items-center gap-1.5">
                {isSubmitting ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save & Select Village</span>
                )}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};
