"use client";

import { useEffect, useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { useHydratedAuth } from '@/lib/hooks';
import { toast } from 'sonner';
import { Trash2, Users, Crown, ShieldCheck, Store, ShoppingCart, Plus, X } from 'lucide-react';
import StatCard from '@/components/ui/stat-card';
import PortalHeader from '@/components/portal/PortalHeader';
import { useTheme } from '@/lib/theme-context';
import MuiDialog from '@mui/material/Dialog';
import MuiDialogTitle from '@mui/material/DialogTitle';
import MuiDialogContent from '@mui/material/DialogContent';
import MuiDialogContentText from '@mui/material/DialogContentText';
import MuiDialogActions from '@mui/material/DialogActions';
import MuiButton from '@mui/material/Button';

interface ShopAssignment {
  portalUserId: string;
  shopId: string;
  shop?: { id: string; name: string; location?: string } | null;
  position?: string;
  isActive?: boolean;
}

interface AvailableShop {
  id: string;
  name: string;
  location?: string;
}

interface PortalUser {
  id: string;
  userId: string;
  shopId?: string | null;
  position: string;
  isActive: boolean;
  user?: {
    id: string;
    email: string;
    name: string;
  };
  shop?: {
    id: string;
    name: string;
  };
  allShops?: ShopAssignment[];
}

function PortalUsersContent() {
  const { token } = useHydratedAuth();
  const [mounted, setMounted] = useState(false);
  const [portalUsers, setPortalUsers] = useState<PortalUser[]>([]);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // Edit user modal state
  const [editingUser, setEditingUser] = useState<PortalUser | null>(null);
  const [updating, setUpdating] = useState(false);
  const [editForm, setEditForm] = useState({ name: '', email: '', role: '', isActive: true });
  const [editModalOpen, setEditModalOpen] = useState(false);

  // Create user modal state
  const [creating, setCreating] = useState(false);
  const [newUser, setNewUser] = useState({ name: '', email: '', password: '', role: '' });
  const [createModalOpen, setCreateModalOpen] = useState(false);

  // Manage shops modal state
  const [shopsModalOpen, setShopsModalOpen] = useState(false);
  const [shopsModalUser, setShopsModalUser] = useState<PortalUser | null>(null);
  const [userShops, setUserShops] = useState<ShopAssignment[]>([]);
  const [availableShops, setAvailableShops] = useState<AvailableShop[]>([]);
  const [addingShop, setAddingShop] = useState(false);
  const [removingShopId, setRemovingShopId] = useState<string | null>(null);
  const [selectedShopToAdd, setSelectedShopToAdd] = useState('');

  useEffect(() => setMounted(true), []);

  const openEditModal = (user: PortalUser) => {
    setEditingUser(user);
    setEditForm({ name: user.user?.name || '', email: user.user?.email || '', role: user.position || '', isActive: user.isActive });
    setEditModalOpen(true);
  };

  const closeEditModal = () => {
    setEditingUser(null);
    setUpdating(false);
    setEditModalOpen(false);
  };

  /* ---- Manage Shops ---- */
  const openShopsModal = async (user: PortalUser) => {
    setShopsModalUser(user);
    setShopsModalOpen(true);
    setSelectedShopToAdd('');

    // Use allShops from the list response if available
    if (user.allShops && user.allShops.length > 0) {
      setUserShops(user.allShops);
    } else if (user.shop) {
      // fallback: single shop
      setUserShops([{ portalUserId: user.id, shopId: user.shopId || '', shop: user.shop, position: user.position, isActive: user.isActive }]);
    } else {
      setUserShops([]);
    }

    // Fetch all available shops
    try {
      const res = await fetch('/api/portal/shops', { headers: { Authorization: `Bearer ${token}` } });
      const json = await res.json();
      if (json.success) setAvailableShops(json.data || []);
    } catch (err) {
      console.error('Failed to fetch shops', err);
    }
  };

  const handleAddShopToUser = async () => {
    if (!selectedShopToAdd || !shopsModalUser) return;
    setAddingShop(true);
    try {
      const res = await fetch(`/api/admin/portal-users/${shopsModalUser.userId}/shops`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopId: selectedShopToAdd }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Shop added successfully');
        const newAssignment: ShopAssignment = json.data;
        setUserShops(prev => [...prev, newAssignment]);
        // Also update the main list
        setPortalUsers(prev =>
          prev.map(u =>
            u.userId === shopsModalUser.userId
              ? { ...u, allShops: [...(u.allShops || []), newAssignment] }
              : u,
          ),
        );
        setSelectedShopToAdd('');
      } else {
        toast.error(json.error || 'Failed to add shop');
      }
    } catch (err) {
      console.error('Add shop failed', err);
      toast.error('Error adding shop');
    } finally {
      setAddingShop(false);
    }
  };

  const handleRemoveShopFromUser = async (shopId: string) => {
    if (!shopsModalUser) return;
    if (userShops.length <= 1) {
      toast.error('Cannot remove the last shop. Delete the user instead.');
      return;
    }
    setRemovingShopId(shopId);
    try {
      const res = await fetch(`/api/admin/portal-users/${shopsModalUser.userId}/shops`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ shopId }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('Shop removed');
        setUserShops(prev => prev.filter(s => s.shopId !== shopId));
        // Also update the main list
        setPortalUsers(prev =>
          prev.map(u =>
            u.userId === shopsModalUser.userId
              ? { ...u, allShops: (u.allShops || []).filter(s => s.shopId !== shopId) }
              : u,
          ),
        );
      } else {
        toast.error(json.error || 'Failed to remove shop');
      }
    } catch (err) {
      console.error('Remove shop failed', err);
      toast.error('Error removing shop');
    } finally {
      setRemovingShopId(null);
    }
  };

  // Shops the user is NOT yet assigned to
  const unassignedShops = availableShops.filter(
    s => !userShops.some(us => us.shopId === s.id),
  );

  const handleUpdate = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!editingUser) return;
    if (!editForm.name || !editForm.email || !editForm.role) return toast.error('Please fill required fields');
    setUpdating(true);
    try {
      const res = await fetch(`/api/admin/portal-users/${editingUser.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: editForm.name, email: editForm.email, role: editForm.role, isActive: editForm.isActive }),
      });
      const json = await res.json();
      if (res.ok && json.success) {
        toast.success('User updated');
        // Prefer authoritative server response when available
        if (json.data) {
          setPortalUsers(prev => prev.map(u => u.id === editingUser.id ? json.data : u));
        } else {
          setPortalUsers(prev => prev.map(u => u.id === editingUser.id ? ({
            ...u,
            position: editForm.role,
            isActive: editForm.isActive,
            user: {
              id: u.user?.id ?? editingUser.user?.id ?? '',
              name: editForm.name,
              email: editForm.email,
            }
          }) : u));
        }
        closeEditModal();
      } else {
        toast.error(json.error || 'Failed to update user');
      }
    } catch (err) {
      console.error('Update failed', err);
      toast.error('Error updating user');
    } finally {
      setUpdating(false);
    }
  };

  const fetchPortalUsers = useCallback(async () => {
    try {
      const response = await fetch('/api/admin/portal-users', { headers: { Authorization: `Bearer ${token}` } });
      if (response.ok) {
        const data = await response.json();
        if (data.success) setPortalUsers(data.data || []);
      }
    } catch (err) {
      console.error('Failed to fetch portal users:', err);
      toast.error('Error loading portal users');
    }
  }, [token]);

  useEffect(() => {
    if (!mounted) return;
    void fetchPortalUsers();
  }, [mounted, fetchPortalUsers]);

  // Theme-aware classes
  const { theme } = useTheme();
  const pageBg = theme === 'dark' ? 'bg-gradient-to-br from-gray-900 to-gray-800' : 'bg-gradient-to-br from-gray-50 to-gray-100';
  const textPrimary = theme === 'dark' ? 'text-white' : 'text-gray-900';
  const textSecondary = theme === 'dark' ? 'text-gray-300' : 'text-gray-600';
  const borderColor = theme === 'dark' ? 'border-gray-800' : 'border-gray-200';
  const controlClass = `rounded-md px-3 py-2 text-sm border ${theme === 'dark' ? 'bg-gray-800 text-white border-gray-700' : 'bg-white text-gray-900 border-gray-200'}`;

  // Filtering tabs / controls
  const [activeTab, setActiveTab] = useState<'all' | 'by-role' | 'by-shop' | 'activity'>('all');
  const [selectedRole, setSelectedRole] = useState('');
  const [selectedShop, setSelectedShop] = useState('');
  const [activityFilter, setActivityFilter] = useState<'all' | 'active' | 'inactive'>('all');

  // Derived lists for filter controls
  // Ensure we filter out undefined/null values with a type guard so Set and Array.from infer string[] correctly
  const roles = Array.from(new Set(portalUsers.map(u => u.position).filter((v): v is string => Boolean(v))));
  const shops = Array.from(new Set(portalUsers.map(u => u.shop?.name).filter((v): v is string => Boolean(v))));

  // Compute displayed users based on active tab + controls
  const displayedUsers = portalUsers.filter(u => {
    if (activeTab === 'by-role') {
      if (!selectedRole) return true;
      return (u.position || '') === selectedRole;
    }
    if (activeTab === 'by-shop') {
      if (!selectedShop) return true;
      return (u.shop?.name || '') === selectedShop;
    }
    if (activeTab === 'activity') {
      if (activityFilter === 'all') return true;
      if (activityFilter === 'active') return u.isActive;
      return !u.isActive;
    }
    return true; // 'all'
  });

  const handleDelete = async (userId: string) => {
    setDeleting(userId);
    try {
      const res = await fetch(`/api/admin/portal-users/${userId}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
      if (res.ok) {
        toast.success('Portal user deleted');
        setPortalUsers(prev => prev.filter(u => u.id !== userId));
      } else {
        toast.error('Failed to delete portal user');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error deleting portal user');
    } finally {
      setDeleting(null);
      setDeleteTarget(null);
    }
  };

  const createUser = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!newUser.name || !newUser.email || !newUser.password || !newUser.role) return toast.error('Please fill required fields');
    setCreating(true);
    try {
      const res = await fetch('/api/admin/portal-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: newUser.name, email: newUser.email, password: newUser.password, role: newUser.role }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('User created');
        // Prefer server response for the new user
        if (json.data) setPortalUsers(prev => [json.data, ...prev]);
        setNewUser({ name: '', email: '', password: '', role: '' });
        setCreateModalOpen(false);
      } else {
        toast.error(json.error || 'Failed to create user');
      }
    } catch (err) {
      console.error(err);
      toast.error('Error creating user');
    } finally {
      setCreating(false);
    }
  };

  if (!mounted) return <div className="flex items-center justify-center min-h-screen"><p className="text-gray-600">Loading...</p></div>;

  // stats
  const totalUsers = portalUsers.length;
  const owners = portalUsers.filter(u => u.position?.toLowerCase() === 'owner' || u.position?.toLowerCase() === 'business owner').length;
  const admins = portalUsers.filter(u => u.position?.toLowerCase() === 'admin' || u.position?.toLowerCase() === 'administrator').length;
  const shopkeepers = portalUsers.filter(u => u.position?.toLowerCase() === 'shopkeeper').length;
  const salesUsers = portalUsers.filter(u => u.position?.toLowerCase() === 'sales user' || u.position?.toLowerCase() === 'sales').length;

  return (
    <div className={`${pageBg} w-full`}>
      <PortalHeader
        backHref="/dashboard"
        title={<><span className="text-4xl">User Management</span></>}
        description="Manage users, roles, and access permissions across your boutique"
        breadcrumbs={[{ label: 'Portal', href: '/portal' }, { label: 'Users' }]}
        actions={(
          <Dialog open={createModalOpen} onOpenChange={setCreateModalOpen}>
            <DialogTrigger asChild>
              <Button className={theme === 'dark' ? 'bg-pink-700 text-white' : 'bg-pink-600 text-white'}>+ Add User</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Create New User</DialogTitle>
                <DialogDescription>User Information</DialogDescription>
              </DialogHeader>
              <form onSubmit={(e) => { void createUser(e); }} className="space-y-4">
                <div>
                  <Label>Full Name *</Label>
                  <Input value={newUser.name} onChange={(e) => setNewUser(prev => ({ ...prev, name: e.target.value }))} placeholder="Enter full name" />
                </div>
                <div>
                  <Label>Email Address *</Label>
                  <Input value={newUser.email} onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))} placeholder="Enter email address" />
                </div>
                <div>
                  <Label>Password *</Label>
                  <Input type="password" value={newUser.password} onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))} placeholder="Create a password" />
                </div>
                <div>
                  <Label>User Role *</Label>
                  <select className={`${controlClass} w-full`} value={newUser.role} onChange={(e) => setNewUser(prev => ({ ...prev, role: e.target.value }))}>
                    <option value="" disabled>Select user role</option>
                    <option value="owner">Business Owner</option>
                    <option value="admin">Administrator</option>
                    <option value="shopkeeper">Shopkeeper</option>
                    <option value="sales_user">Sales User</option>
                  </select>
                </div>
                <div className="rounded-md border border-amber-200 bg-amber-50 p-4">
                  <h3 className="font-semibold">Security Notice</h3>
                  <ul className="mt-2 text-sm list-disc pl-5 text-amber-800">
                    <li>User will receive login credentials via email</li>
                    <li>They will be prompted to change password on first login</li>
                    <li>Access permissions are based on the assigned role</li>
                    <li>Role and shop assignments can be modified later</li>
                  </ul>
                </div>
                <div className="flex gap-3 pt-2">
                  <Button type="submit" className={`flex-1 ${theme === 'dark' ? 'bg-pink-700 text-white' : 'bg-pink-600 text-white'}`} disabled={creating}>{creating ? 'Creating...' : 'Create User'}</Button>
                  <Button variant="outline" type="button" onClick={() => setNewUser({ name: '', email: '', password: '', role: '' })}>Clear Form</Button>
                </div>
               </form>
               </DialogContent>
             </Dialog>
           )}
      />

      {/* Stat cards */}
      <div className="px-2 sm:px-2 py-6 pb-2 w-full">
        <div className="grid grid-cols-1 md:grid-cols-5 gap-4 mb-6">
          <StatCard title="Total Users" value={totalUsers} subtitle={`${portalUsers.filter(u => u.isActive).length} active`} icon={<Users className="h-8 w-8 text-pink-700" />} />
          <StatCard title="Owners" value={owners} subtitle="Business owners" icon={<Crown className="h-8 w-8 text-amber-500" />} />
          <StatCard title="Admins" value={admins} subtitle="Administrators" icon={<ShieldCheck className="h-8 w-8 text-sky-600" />} />
          <StatCard title="Shopkeepers" value={shopkeepers} subtitle="Shop managers" icon={<Store className="h-8 w-8 text-emerald-600" />} />
          <StatCard title="Sales Users" value={salesUsers} subtitle="Sales staff" icon={<ShoppingCart className="h-8 w-8 text-rose-600" />} />
        </div>
      </div>

      {/* Tabs + inline filter controls */}
      <div className="px-4 sm:px-6 pb-0 w-full mb-4">
        <div className={`flex flex-wrap items-center gap-2 ${textPrimary}`}>
          <Button variant={activeTab === 'all' ? 'default' : 'outline'} onClick={() => { setActiveTab('all'); setSelectedRole(''); setSelectedShop(''); setActivityFilter('all'); }}>All Users</Button>
          <Button variant={activeTab === 'by-role' ? 'default' : 'outline'} onClick={() => { setActiveTab('by-role'); setSelectedShop(''); setActivityFilter('all'); }}>By Role</Button>
          <Button variant={activeTab === 'by-shop' ? 'default' : 'outline'} onClick={() => { setActiveTab('by-shop'); setSelectedRole(''); setActivityFilter('all'); }}>By Shop</Button>
          <Button variant={activeTab === 'activity' ? 'default' : 'outline'} onClick={() => { setActiveTab('activity'); setSelectedRole(''); setSelectedShop(''); }}>Activity</Button>

          {/* Inline controls shown when a tab is active */}
          {activeTab === 'by-role' && (
            <div className="ml-2">
              <select value={selectedRole} onChange={(e) => setSelectedRole(e.target.value)} className={controlClass}>
                <option value="">All roles</option>
                {roles.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
          )}

          {activeTab === 'by-shop' && (
            <div className="ml-2">
              <select value={selectedShop} onChange={(e) => setSelectedShop(e.target.value)} className={controlClass}>
                <option value="">All shops</option>
                {shops.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
          )}

          {activeTab === 'activity' && (
            <div className="ml-2 inline-flex items-center gap-2">
              <Button variant={activityFilter === 'all' ? 'default' : 'outline'} onClick={() => setActivityFilter('all')}>All</Button>
              <Button variant={activityFilter === 'active' ? 'default' : 'outline'} onClick={() => setActivityFilter('active')}>Active</Button>
              <Button variant={activityFilter === 'inactive' ? 'default' : 'outline'} onClick={() => setActivityFilter('inactive')}>Inactive</Button>
            </div>
          )}

          {/* Clear filters quick action */}
          <div className="ml-auto">
            <Button variant="ghost" onClick={() => { setActiveTab('all'); setSelectedRole(''); setSelectedShop(''); setActivityFilter('all'); }}>Clear</Button>
          </div>
        </div>
      </div>

      {/* Users table */}
      <div className="px-4 sm:px-2 pb-12 w-full">
        <Card>
          <CardHeader>
            <CardTitle>All Users</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className={`text-left text-sm ${textSecondary} border-b ${borderColor}`}>
                    <th className="py-3">User</th>
                    <th className="py-3">Role</th>
                    <th className="py-3">Shop Assignment</th>
                    <th className="py-3">Status</th>
                    <th className="py-3">Created</th>
                    <th className="py-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedUsers.map(u => (
                    <tr key={u.id} className="border-b">
                      <td className="py-4">
                        <div className="font-medium">{u.user?.name || 'Unknown'}</div>
                        <div className={`text-xs ${textSecondary}`}>{u.user?.email}</div>
                      </td>
                      <td className="py-4">
                        <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-pink-50 text-pink-700">{u.position}</span>
                      </td>
                      <td className={`py-4 ${textSecondary}`}>
                        <div className="flex flex-wrap items-center gap-1.5">
                          {(u.allShops && u.allShops.length > 0) ? (
                            u.allShops.map(s => (
                              <Badge key={s.shopId} className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                                {s.shop?.name || s.shopId}
                              </Badge>
                            ))
                          ) : u.shop ? (
                            <Badge className="text-xs px-2 py-0.5 bg-blue-50 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
                              {u.shop.name}
                            </Badge>
                          ) : (
                            <span className="text-gray-400 italic text-xs">No assignment</span>
                          )}
                          {/* Manage shops button (only for non-admin rows that have a real userId) */}
                          {!String(u.id).startsWith('admin-') && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-6 w-6 text-blue-600 hover:text-blue-800 dark:text-blue-400"
                              onClick={() => openShopsModal(u)}
                              title="Manage shop assignments"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </Button>
                          )}
                        </div>
                      </td>
                      <td className="py-4">
                        {u.isActive ? <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${theme === 'dark' ? 'bg-pink-800 text-white' : 'bg-pink-50 text-pink-700'}`}>Active</span> : <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${theme === 'dark' ? 'bg-amber-800 text-white' : 'bg-amber-50 text-amber-700'}`}>Inactive</span>}
                      </td>
                      <td className={`py-4 ${textSecondary}`}>—</td>
                      <td className="py-4">
                        <div className="flex items-center gap-3">
                          <Button variant="ghost" size="icon" onClick={() => openEditModal(u)} className="hover:text-slate-700">Edit</Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget({ id: u.id, name: u.user?.name ?? u.id })} disabled={deleting === u.id} className="text-destructive hover:text-destructive"><Trash2 className="h-4 w-4"/></Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit user modal (simple controlled modal) */}
      <Dialog open={editModalOpen} onOpenChange={(open) => { if (!open) closeEditModal(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>Update user details and role</DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { void handleUpdate(e); }} className="space-y-4 mt-2">
            <div>
              <Label>Full Name *</Label>
              <Input value={editForm.name} onChange={(e) => setEditForm(prev => ({ ...prev, name: e.target.value }))} placeholder="Enter full name" />
            </div>
            <div>
              <Label>Email Address *</Label>
              <Input value={editForm.email} onChange={(e) => setEditForm(prev => ({ ...prev, email: e.target.value }))} placeholder="Enter email address" />
            </div>
            <div>
              <Label>User Role *</Label>
              <select className={`${controlClass} w-full`} value={editForm.role} onChange={(e) => setEditForm(prev => ({ ...prev, role: e.target.value }))}>
                <option value="" disabled>Select user role</option>
                <option value="owner">Business Owner</option>
                <option value="admin">Administrator</option>
                <option value="shopkeeper">Shopkeeper</option>
                <option value="sales_user">Sales User</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <input id="active" type="checkbox" className="h-4 w-4" checked={editForm.isActive} onChange={(e) => setEditForm(prev => ({ ...prev, isActive: e.target.checked }))} />
              <label htmlFor="active" className="text-sm">Active</label>
            </div>
            <div className="flex gap-3 pt-2">
              <Button type="submit" className={`flex-1 ${theme === 'dark' ? 'bg-pink-700 text-white' : 'bg-pink-600 text-white'}`} disabled={updating}>{updating ? 'Updating...' : 'Update User'}</Button>
               <Button variant="outline" type="button" onClick={() => closeEditModal()}>Cancel</Button>
             </div>
           </form>
         </DialogContent>
       </Dialog>

      {/* Manage Shops modal */}
      <Dialog open={shopsModalOpen} onOpenChange={(open) => { if (!open) { setShopsModalOpen(false); setShopsModalUser(null); } }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Manage Shop Assignments</DialogTitle>
            <DialogDescription>
              {shopsModalUser?.user?.name || 'User'} — assign or remove shops
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 mt-2">
            {/* Current shops */}
            <div>
              <Label className="mb-2 block">Current Shops</Label>
              {userShops.length === 0 ? (
                <p className="text-sm text-gray-500 italic">No shop assignments</p>
              ) : (
                <div className="space-y-2">
                  {userShops.map(s => (
                    <div
                      key={s.shopId}
                      className={`flex items-center justify-between p-3 rounded-lg ${theme === 'dark' ? 'bg-gray-800' : 'bg-gray-50'}`}
                    >
                      <div>
                        <p className="font-medium text-sm">{s.shop?.name || s.shopId}</p>
                        {s.shop?.location && (
                          <p className="text-xs text-gray-500">{s.shop.location}</p>
                        )}
                        <p className="text-xs text-gray-400 mt-0.5">Role: {s.position || '—'}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-900/30 h-8 w-8"
                        onClick={() => handleRemoveShopFromUser(s.shopId)}
                        disabled={removingShopId === s.shopId || userShops.length <= 1}
                        title={userShops.length <= 1 ? 'Cannot remove last shop' : 'Remove shop'}
                      >
                        {removingShopId === s.shopId ? (
                          <div className="h-4 w-4 border-2 border-red-400 border-t-transparent rounded-full animate-spin" />
                        ) : (
                          <X className="h-4 w-4" />
                        )}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Add new shop */}
            {unassignedShops.length > 0 && (
              <div>
                <Label className="mb-2 block">Add Another Shop</Label>
                <div className="flex gap-2">
                  <select
                    className={`${controlClass} flex-1`}
                    value={selectedShopToAdd}
                    onChange={e => setSelectedShopToAdd(e.target.value)}
                  >
                    <option value="" disabled>Select a shop…</option>
                    {unassignedShops.map(s => (
                      <option key={s.id} value={s.id}>{s.name}{s.location ? ` — ${s.location}` : ''}</option>
                    ))}
                  </select>
                  <Button
                    onClick={handleAddShopToUser}
                    disabled={!selectedShopToAdd || addingShop}
                    className={theme === 'dark' ? 'bg-pink-700 text-white' : 'bg-pink-600 text-white'}
                  >
                    {addingShop ? 'Adding…' : 'Add'}
                  </Button>
                </div>
              </div>
            )}

            {unassignedShops.length === 0 && userShops.length > 0 && (
              <p className="text-sm text-gray-500 italic">User is assigned to all available shops</p>
            )}

            <div className="flex justify-end pt-2">
              <Button variant="outline" onClick={() => { setShopsModalOpen(false); setShopsModalUser(null); }}>Done</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Delete User Confirmation Modal */}
      <MuiDialog open={Boolean(deleteTarget)} onClose={() => !deleting && setDeleteTarget(null)} maxWidth="xs" fullWidth PaperProps={{ sx: { borderRadius: 3, p: 1 } }}>
        <MuiDialogTitle sx={{ fontWeight: 700 }}>🗑️ Delete Portal User</MuiDialogTitle>
        <MuiDialogContent>
          <MuiDialogContentText>
            Are you sure you want to delete <strong>{deleteTarget?.name}</strong>? This action cannot be undone.
          </MuiDialogContentText>
        </MuiDialogContent>
        <MuiDialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
          <MuiButton onClick={() => setDeleteTarget(null)} variant="outlined" size="small" disabled={Boolean(deleting)}>Cancel</MuiButton>
          <MuiButton onClick={() => deleteTarget && void handleDelete(deleteTarget.id)} variant="contained" size="small" disabled={Boolean(deleting)} sx={{ bgcolor: '#ef4444', '&:hover': { bgcolor: '#dc2626' } }}>{deleting ? 'Deleting…' : 'Delete'}</MuiButton>
        </MuiDialogActions>
      </MuiDialog>
     </div>
   );
}

export default function PortalUsersPage() {
  return <PortalUsersContent />;
}
